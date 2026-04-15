"""Lightweight HTTP server for dbt commands inside Cloudflare Container.

Target: Snowflake (key pair authentication).

Artifacts are saved to R2 via Outbound Workers.
Container sends HTTP to http://r2.worker/{key} -> Worker's outboundByHost
intercepts and translates to R2 binding calls.

The Snowflake private key is delivered as a Cloudflare Worker secret
(SNOWFLAKE_PRIVATE_KEY, PEM content) and written to a tmp file at
startup so dbt-snowflake's private_key_path config can point at it.
"""

import json
import os
import re
import stat
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.request import Request, urlopen

R2_HOST = "http://r2.worker"
DBT_TIMEOUT = 3600  # 1 hour

ALLOWED_TARGETS = {"dev", "prod"}
# dbt graph selector: alphanumeric, underscores, dots, plus, at, colon, slash, star
SELECT_PATTERN = re.compile(r"^[a-zA-Z0-9_.+@:/\*\- ]+$")

PRIVATE_KEY_PATH = "/tmp/snowflake_rsa_key.p8"

ARTIFACT_FILES: list[tuple[str, str]] = [
    ("target/manifest.json", "application/json"),
    ("target/run_results.json", "application/json"),
    ("target/catalog.json", "application/json"),
    ("target/sources.json", "application/json"),
    ("target/index.html", "text/html"),
]


def bootstrap_private_key() -> None:
    """Write SNOWFLAKE_PRIVATE_KEY env var to a file and export the path.

    profiles.yml references env_var('SNOWFLAKE_PRIVATE_KEY_PATH'), so once
    we drop the PEM content on disk we just set that variable for any child
    dbt process.
    """
    pem = os.environ.get("SNOWFLAKE_PRIVATE_KEY")
    if not pem:
        # Already passed as a file path (e.g. for local debugging) -> nothing to do.
        return
    with open(PRIVATE_KEY_PATH, "w") as f:
        f.write(pem)
    os.chmod(PRIVATE_KEY_PATH, stat.S_IRUSR | stat.S_IWUSR)
    os.environ["SNOWFLAKE_PRIVATE_KEY_PATH"] = PRIVATE_KEY_PATH


class DbtHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self._json_response(200, {"status": "ok"})
        elif self.path == "/debug-env":
            self._json_response(
                200,
                {
                    key: f"len={len(value)}"
                    for key, value in sorted(os.environ.items())
                    if key.startswith("SNOWFLAKE_") or key == "API_KEY"
                },
            )
        else:
            self._json_response(404, {"error": "not found"})

    def do_POST(self):
        if self.path in ("/run", "/seed", "/test", "/build"):
            self._run_dbt(self.path.lstrip("/"))
        elif self.path == "/docs":
            self._run_docs_generate()
        elif self.path == "/build-docs":
            self._run_build_and_docs()
        else:
            self._json_response(404, {"error": "not found"})

    def _parse_body(self) -> dict | None:
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            return {}
        try:
            return json.loads(self.rfile.read(content_length))
        except json.JSONDecodeError:
            self._json_response(400, {"error": "invalid JSON"})
            return None

    def _validate_target(self, target: str) -> bool:
        if target not in ALLOWED_TARGETS:
            self._json_response(
                400, {"error": f"invalid target: {target}. allowed: {ALLOWED_TARGETS}"}
            )
            return False
        return True

    def _validate_select(self, select: str) -> bool:
        if not SELECT_PATTERN.match(select):
            self._json_response(400, {"error": f"invalid select pattern: {select}"})
            return False
        return True

    def _run_dbt(self, command: str):
        body = self._parse_body()
        if body is None:
            return

        target = body.get("target", "dev")
        if not self._validate_target(target):
            return

        select = body.get("select", None)
        if select and not self._validate_select(select):
            return

        full_refresh = body.get("full_refresh", False)

        cmd = ["uv", "run", "dbt", command, "--target", target, "--profiles-dir", "."]
        if select:
            cmd.extend(["--select", select])
        if full_refresh:
            cmd.append("--full-refresh")

        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, cwd="/app", timeout=DBT_TIMEOUT
            )
        except subprocess.TimeoutExpired:
            self._json_response(504, {"error": f"dbt {command} timed out"})
            return

        artifacts_saved: list[str] = []
        if result.returncode == 0 and command in ("run", "build"):
            artifacts_saved = self._upload_artifacts(
                [
                    ("target/manifest.json", "application/json"),
                    ("target/run_results.json", "application/json"),
                    ("target/catalog.json", "application/json"),
                    ("target/sources.json", "application/json"),
                ]
            )

        self._json_response(
            200 if result.returncode == 0 else 500,
            {
                "command": command,
                "returncode": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "artifacts_saved": artifacts_saved,
            },
        )

    def _run_build_and_docs(self):
        """Run `dbt build` then `dbt docs generate` in one shot.

        On build failure, docs generate is skipped and the combined
        response returns HTTP 500 with the build stdout/stderr.
        On build success, docs generate runs and ARTIFACT_FILES
        (manifest/run_results/catalog/sources + index.html) are
        uploaded to R2.
        """
        body = self._parse_body()
        if body is None:
            return

        target = body.get("target", "dev")
        if not self._validate_target(target):
            return

        select = body.get("select", None)
        if select and not self._validate_select(select):
            return

        full_refresh = body.get("full_refresh", False)

        build_cmd = [
            "uv", "run", "dbt", "build",
            "--target", target, "--profiles-dir", ".",
        ]
        if select:
            build_cmd.extend(["--select", select])
        if full_refresh:
            build_cmd.append("--full-refresh")

        try:
            build_result = subprocess.run(
                build_cmd, capture_output=True, text=True, cwd="/app", timeout=DBT_TIMEOUT
            )
        except subprocess.TimeoutExpired:
            self._json_response(504, {"error": "dbt build timed out"})
            return

        if build_result.returncode != 0:
            self._json_response(
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
            self._json_response(504, {"error": "dbt docs generate timed out"})
            return

        artifacts_saved: list[str] = []
        if docs_result.returncode == 0:
            artifacts_saved = self._upload_artifacts(ARTIFACT_FILES)

        self._json_response(
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

    def _run_docs_generate(self):
        body = self._parse_body()
        if body is None:
            return

        target = body.get("target", "dev")
        if not self._validate_target(target):
            return

        cmd = [
            "uv",
            "run",
            "dbt",
            "docs",
            "generate",
            "--target",
            target,
            "--profiles-dir",
            ".",
        ]

        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, cwd="/app", timeout=DBT_TIMEOUT
            )
        except subprocess.TimeoutExpired:
            self._json_response(504, {"error": "dbt docs generate timed out"})
            return

        artifacts_saved: list[str] = []
        if result.returncode == 0:
            artifacts_saved = self._upload_artifacts(ARTIFACT_FILES)

        self._json_response(
            200 if result.returncode == 0 else 500,
            {
                "command": "docs generate",
                "returncode": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "artifacts_saved": artifacts_saved,
            },
        )

    def _upload_artifacts(self, files: list[tuple[str, str]]) -> list[str]:
        """Upload dbt artifacts to R2 via Outbound Workers."""
        saved = []
        for artifact, content_type in files:
            src = os.path.join("/app", artifact)
            if not os.path.exists(src):
                continue

            filename = os.path.basename(artifact)

            with open(src, "rb") as f:
                data = f.read()

            if self._put_r2(filename, data, content_type):
                saved.append(filename)

        return saved

    def _put_r2(
        self, key: str, data: bytes, content_type: str = "application/json"
    ) -> bool:
        """PUT object to R2 via Outbound Worker at http://r2.worker."""
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
            print(f"Failed to PUT {key} to R2: {e}")
            return False

    def _json_response(self, status: int, body: dict):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())


if __name__ == "__main__":
    # Debug: dump which SNOWFLAKE_* env vars are visible to the
    # container. Values are masked to just their length so we can
    # tell "set" from "missing" without leaking secrets.
    print("=== container env (SNOWFLAKE_*/API_KEY) ===", flush=True)
    for key in sorted(os.environ.keys()):
        if key.startswith("SNOWFLAKE_") or key == "API_KEY":
            value = os.environ[key]
            print(f"  {key}: len={len(value)}", flush=True)
    print("===========================================", flush=True)

    bootstrap_private_key()
    port = int(os.environ.get("PORT", "8080"))
    server = HTTPServer(("0.0.0.0", port), DbtHandler)
    print(f"dbt-runner server listening on port {port}", flush=True)
    server.serve_forever()
