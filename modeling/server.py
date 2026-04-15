"""Lightweight HTTP server for dbt commands inside Cloudflare Container.

Target: Snowflake (key pair authentication).

Artifacts are saved to R2 via Outbound Workers.
Container sends HTTP to http://r2.worker/{key} -> Worker's outboundByHost
intercepts and translates to R2 binding calls.

The Snowflake private key is delivered as a Cloudflare Worker secret
(SNOWFLAKE_PRIVATE_KEY, PEM content) and written to a tmp file at
startup so dbt-snowflake's private_key_path config can point at it.

Job model
---------
The container supports two modes for running dbt commands:

* Legacy synchronous endpoints (POST /run, /build, /test, /seed,
  /docs, /build-docs) — block until dbt finishes, return a JSON
  summary. Useful for one-shot local tests but runs into the
  Worker subrequest wall clock on long builds.

* Async job endpoints (POST /jobs, GET /jobs/<id>,
  POST /jobs/<id>/cancel) — start dbt as a background subprocess
  under a job id, return immediately. The JobRegistry Durable
  Object in the Worker layer polls GET /jobs/<id> for completion.
  This is what Workflows / Cron / webhook paths drive.
"""

import json
import os
import re
import signal
import stat
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any
from urllib.request import Request, urlopen

R2_HOST = "http://r2.worker"
DBT_TIMEOUT = 3600  # 1 hour

ALLOWED_TARGETS = {"dev", "prod"}
ALLOWED_COMMANDS = {"run", "build", "test", "seed", "docs", "build-docs"}
# dbt graph selector: alphanumeric, underscores, dots, plus, at, colon, slash, star
SELECT_PATTERN = re.compile(r"^[a-zA-Z0-9_.+@:/\*\- ]+$")

PRIVATE_KEY_PATH = "/tmp/snowflake_rsa_key.p8"
STDOUT_TAIL_LINES = 50

ARTIFACT_FILES: list[tuple[str, str]] = [
    ("target/manifest.json", "application/json"),
    ("target/run_results.json", "application/json"),
    ("target/catalog.json", "application/json"),
    ("target/sources.json", "application/json"),
    ("target/index.html", "text/html"),
]


def bootstrap_private_key() -> None:
    """Write SNOWFLAKE_PRIVATE_KEY env var to a file and export the path."""
    pem = os.environ.get("SNOWFLAKE_PRIVATE_KEY")
    if not pem:
        return
    with open(PRIVATE_KEY_PATH, "w") as f:
        f.write(pem)
    os.chmod(PRIVATE_KEY_PATH, stat.S_IRUSR | stat.S_IWUSR)
    os.environ["SNOWFLAKE_PRIVATE_KEY_PATH"] = PRIVATE_KEY_PATH


# ---------------------------------------------------------------------------
# Job registry (in-process)
# ---------------------------------------------------------------------------
#
# Jobs live for the lifetime of the container process. If the container
# sleeps and restarts the in-memory map is lost -- that's why the Worker
# side JobRegistry DO is the source of truth for persistent job state,
# and this module just tracks "what is my subprocess currently doing".

_JOB_LOCK = threading.Lock()
_JOBS: dict[str, dict[str, Any]] = {}


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _new_job(command: str, target: str, select: str | None, full_refresh: bool) -> str:
    job_id = str(uuid.uuid4())
    with _JOB_LOCK:
        _JOBS[job_id] = {
            "id": job_id,
            "state": "queued",
            "command": command,
            "target": target,
            "select": select,
            "full_refresh": full_refresh,
            "started_at": _now(),
            "finished_at": None,
            "returncode": None,
            "stdout_tail": "",
            "artifacts_saved": [],
            "error": None,
            "_process": None,
            "_stdout_lines": [],
        }
    return job_id


def _get_job(job_id: str) -> dict[str, Any] | None:
    with _JOB_LOCK:
        job = _JOBS.get(job_id)
        if job is None:
            return None
        return _snapshot(job)


def _snapshot(job: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": job["id"],
        "state": job["state"],
        "command": job["command"],
        "target": job["target"],
        "select": job["select"],
        "full_refresh": job["full_refresh"],
        "started_at": job["started_at"],
        "finished_at": job["finished_at"],
        "returncode": job["returncode"],
        "stdout_tail": "\n".join(job["_stdout_lines"][-STDOUT_TAIL_LINES:]),
        "artifacts_saved": list(job["artifacts_saved"]),
        "error": job["error"],
    }


def _list_jobs() -> list[dict[str, Any]]:
    with _JOB_LOCK:
        return [_snapshot(j) for j in _JOBS.values()]


def _update_job(job_id: str, **patch: Any) -> None:
    with _JOB_LOCK:
        if job_id in _JOBS:
            _JOBS[job_id].update(patch)


def _append_stdout(job_id: str, line: str) -> None:
    with _JOB_LOCK:
        if job_id in _JOBS:
            _JOBS[job_id]["_stdout_lines"].append(line)


def _build_dbt_command(
    command: str, target: str, select: str | None, full_refresh: bool
) -> list[str]:
    cmd = ["uv", "run", "dbt", command, "--target", target, "--profiles-dir", "."]
    if select:
        cmd.extend(["--select", select])
    if full_refresh:
        cmd.append("--full-refresh")
    return cmd


def _upload_artifacts(files: list[tuple[str, str]]) -> list[str]:
    saved = []
    for artifact, content_type in files:
        src = os.path.join("/app", artifact)
        if not os.path.exists(src):
            continue
        filename = os.path.basename(artifact)
        with open(src, "rb") as f:
            data = f.read()
        if _put_r2(filename, data, content_type):
            saved.append(filename)
    return saved


def _put_r2(key: str, data: bytes, content_type: str) -> bool:
    req = Request(
        f"{R2_HOST}/{key}",
        data=data,
        method="PUT",
        headers={"Content-Type": content_type},
    )
    try:
        urlopen(req, timeout=30)
        return True
    except Exception as e:
        print(f"Failed to PUT {key} to R2: {e}", flush=True)
        return False


def _run_job_thread(job_id: str) -> None:
    """Background thread that drives a dbt command for one job."""
    job = _JOBS.get(job_id)
    if job is None:
        return

    command = job["command"]
    target = job["target"]
    select = job["select"]
    full_refresh = job["full_refresh"]

    try:
        if command == "build-docs":
            rc = _run_build_then_docs(job_id, target, select, full_refresh)
        elif command == "docs":
            rc = _run_one(job_id, ["uv", "run", "dbt", "docs", "generate", "--target", target, "--profiles-dir", "."])
            if rc == 0:
                saved = _upload_artifacts(ARTIFACT_FILES)
                _update_job(job_id, artifacts_saved=saved)
        else:
            cmd = _build_dbt_command(command, target, select, full_refresh)
            rc = _run_one(job_id, cmd)
            if rc == 0 and command in ("run", "build"):
                saved = _upload_artifacts(
                    [
                        ("target/manifest.json", "application/json"),
                        ("target/run_results.json", "application/json"),
                        ("target/catalog.json", "application/json"),
                        ("target/sources.json", "application/json"),
                    ]
                )
                _update_job(job_id, artifacts_saved=saved)

        final_state = "complete" if rc == 0 else "failed"
        _update_job(
            job_id,
            state=final_state,
            returncode=rc,
            finished_at=_now(),
        )
    except Exception as e:
        _update_job(
            job_id,
            state="error",
            finished_at=_now(),
            error=str(e),
        )


def _run_build_then_docs(
    job_id: str, target: str, select: str | None, full_refresh: bool
) -> int:
    build_cmd = _build_dbt_command("build", target, select, full_refresh)
    rc = _run_one(job_id, build_cmd)
    if rc != 0:
        return rc
    docs_cmd = [
        "uv", "run", "dbt", "docs", "generate",
        "--target", target, "--profiles-dir", ".",
    ]
    rc = _run_one(job_id, docs_cmd)
    if rc == 0:
        saved = _upload_artifacts(ARTIFACT_FILES)
        _update_job(job_id, artifacts_saved=saved)
    return rc


def _run_one(job_id: str, cmd: list[str]) -> int:
    """Run a single dbt subprocess, streaming stdout into the job record."""
    _update_job(job_id, state="running")
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            cwd="/app",
            text=True,
            bufsize=1,
        )
    except Exception as e:
        _update_job(job_id, error=f"failed to spawn: {e}")
        return 127

    with _JOB_LOCK:
        if job_id in _JOBS:
            _JOBS[job_id]["_process"] = proc

    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            _append_stdout(job_id, line.rstrip("\n"))
    finally:
        proc.wait(timeout=DBT_TIMEOUT)

    return proc.returncode if proc.returncode is not None else -1


def _cancel_job(job_id: str) -> bool:
    with _JOB_LOCK:
        job = _JOBS.get(job_id)
        if job is None:
            return False
        proc = job.get("_process")
        if proc is not None and proc.poll() is None:
            try:
                proc.send_signal(signal.SIGTERM)
            except Exception:
                pass
        job["state"] = "cancelled"
        job["finished_at"] = _now()
        return True


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------


class DbtHandler(BaseHTTPRequestHandler):
    # --- GET --------------------------------------------------------------

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"status": "ok"})
        elif self.path == "/debug-env":
            self._json(
                200,
                {
                    key: f"len={len(value)}"
                    for key, value in sorted(os.environ.items())
                    if key.startswith("SNOWFLAKE_") or key == "API_KEY"
                },
            )
        elif self.path == "/jobs":
            self._json(200, {"jobs": _list_jobs()})
        elif self.path.startswith("/jobs/"):
            job_id = self.path[len("/jobs/"):]
            job = _get_job(job_id)
            if job is None:
                self._json(404, {"error": "job not found"})
            else:
                self._json(200, job)
        else:
            self._json(404, {"error": "not found"})

    # --- POST -------------------------------------------------------------

    def do_POST(self):
        # Async job lifecycle
        if self.path == "/jobs":
            self._submit_job()
            return
        if self.path.startswith("/jobs/") and self.path.endswith("/cancel"):
            job_id = self.path[len("/jobs/"): -len("/cancel")]
            if _cancel_job(job_id):
                self._json(200, {"id": job_id, "state": "cancelled"})
            else:
                self._json(404, {"error": "job not found"})
            return

        # Legacy sync endpoints (kept for local testing)
        if self.path in ("/run", "/seed", "/test", "/build"):
            self._run_dbt_sync(self.path.lstrip("/"))
            return
        if self.path == "/docs":
            self._run_docs_generate_sync()
            return
        if self.path == "/build-docs":
            self._run_build_and_docs_sync()
            return

        self._json(404, {"error": "not found"})

    # --- helpers ----------------------------------------------------------

    def _parse_body(self) -> dict | None:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            self._json(400, {"error": "invalid JSON"})
            return None

    def _validate(self, command: str, target: str, select: str | None) -> bool:
        if command not in ALLOWED_COMMANDS:
            self._json(400, {"error": f"invalid command: {command}"})
            return False
        if target not in ALLOWED_TARGETS:
            self._json(400, {"error": f"invalid target: {target}"})
            return False
        if select and not SELECT_PATTERN.match(select):
            self._json(400, {"error": f"invalid select pattern"})
            return False
        return True

    def _submit_job(self):
        body = self._parse_body()
        if body is None:
            return
        command = body.get("command", "build")
        target = body.get("target", "dev")
        select = body.get("select")
        full_refresh = bool(body.get("full_refresh", False))

        if not self._validate(command, target, select):
            return

        job_id = _new_job(command, target, select, full_refresh)
        thread = threading.Thread(target=_run_job_thread, args=(job_id,), daemon=True)
        thread.start()

        self._json(202, _get_job(job_id) or {"id": job_id, "state": "queued"})

    # --- legacy sync wrappers --------------------------------------------

    def _run_dbt_sync(self, command: str):
        body = self._parse_body()
        if body is None:
            return
        target = body.get("target", "dev")
        select = body.get("select")
        full_refresh = bool(body.get("full_refresh", False))
        if not self._validate(command, target, select):
            return

        cmd = _build_dbt_command(command, target, select, full_refresh)
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, cwd="/app", timeout=DBT_TIMEOUT
            )
        except subprocess.TimeoutExpired:
            self._json(504, {"error": f"dbt {command} timed out"})
            return

        artifacts_saved: list[str] = []
        if result.returncode == 0 and command in ("run", "build"):
            artifacts_saved = _upload_artifacts(
                [
                    ("target/manifest.json", "application/json"),
                    ("target/run_results.json", "application/json"),
                    ("target/catalog.json", "application/json"),
                    ("target/sources.json", "application/json"),
                ]
            )

        self._json(
            200 if result.returncode == 0 else 500,
            {
                "command": command,
                "returncode": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "artifacts_saved": artifacts_saved,
            },
        )

    def _run_docs_generate_sync(self):
        body = self._parse_body()
        if body is None:
            return
        target = body.get("target", "dev")
        if target not in ALLOWED_TARGETS:
            self._json(400, {"error": f"invalid target: {target}"})
            return
        cmd = [
            "uv", "run", "dbt", "docs", "generate",
            "--target", target, "--profiles-dir", ".",
        ]
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, cwd="/app", timeout=DBT_TIMEOUT
            )
        except subprocess.TimeoutExpired:
            self._json(504, {"error": "dbt docs generate timed out"})
            return

        artifacts_saved: list[str] = []
        if result.returncode == 0:
            artifacts_saved = _upload_artifacts(ARTIFACT_FILES)

        self._json(
            200 if result.returncode == 0 else 500,
            {
                "command": "docs generate",
                "returncode": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "artifacts_saved": artifacts_saved,
            },
        )

    def _run_build_and_docs_sync(self):
        body = self._parse_body()
        if body is None:
            return
        target = body.get("target", "dev")
        select = body.get("select")
        full_refresh = bool(body.get("full_refresh", False))
        if not self._validate("build", target, select):
            return

        build_cmd = _build_dbt_command("build", target, select, full_refresh)
        try:
            build_result = subprocess.run(
                build_cmd, capture_output=True, text=True, cwd="/app", timeout=DBT_TIMEOUT
            )
        except subprocess.TimeoutExpired:
            self._json(504, {"error": "dbt build timed out"})
            return

        if build_result.returncode != 0:
            self._json(
                500,
                {
                    "command": "build-docs",
                    "stage": "build",
                    "build": {
                        "returncode": build_result.returncode,
                        "stdout": build_result.stdout,
                        "stderr": build_result.stderr,
                    },
                    "docs": None,
                    "artifacts_saved": [],
                },
            )
            return

        docs_cmd = [
            "uv", "run", "dbt", "docs", "generate",
            "--target", target, "--profiles-dir", ".",
        ]
        try:
            docs_result = subprocess.run(
                docs_cmd, capture_output=True, text=True, cwd="/app", timeout=DBT_TIMEOUT
            )
        except subprocess.TimeoutExpired:
            self._json(504, {"error": "dbt docs generate timed out"})
            return

        artifacts_saved: list[str] = []
        if docs_result.returncode == 0:
            artifacts_saved = _upload_artifacts(ARTIFACT_FILES)

        self._json(
            200 if docs_result.returncode == 0 else 500,
            {
                "command": "build-docs",
                "stage": "docs" if docs_result.returncode != 0 else "complete",
                "build": {
                    "returncode": build_result.returncode,
                    "stdout": build_result.stdout,
                    "stderr": build_result.stderr,
                },
                "docs": {
                    "returncode": docs_result.returncode,
                    "stdout": docs_result.stdout,
                    "stderr": docs_result.stderr,
                },
                "artifacts_saved": artifacts_saved,
            },
        )

    # --- HTTP plumbing ----------------------------------------------------

    def _json(self, status: int, body: dict):
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class ThreadingHTTPServer(HTTPServer):
    """Need threaded server so /jobs poll requests aren't blocked by a
    running build job thread (background threads are daemonized)."""

    def process_request(self, request, client_address):
        t = threading.Thread(
            target=self.process_request_thread,
            args=(request, client_address),
            daemon=True,
        )
        t.start()

    def process_request_thread(self, request, client_address):
        try:
            self.finish_request(request, client_address)
        except Exception:
            self.handle_error(request, client_address)
        finally:
            self.shutdown_request(request)


if __name__ == "__main__":
    # Debug: dump which SNOWFLAKE_* env vars are visible to the
    # container. Values are masked to just their length.
    print("=== container env (SNOWFLAKE_*/API_KEY) ===", flush=True)
    for key in sorted(os.environ.keys()):
        if key.startswith("SNOWFLAKE_") or key == "API_KEY":
            value = os.environ[key]
            print(f"  {key}: len={len(value)}", flush=True)
    print("===========================================", flush=True)

    bootstrap_private_key()
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), DbtHandler)
    print(f"dbt-runner server listening on port {port}", flush=True)
    server.serve_forever()
