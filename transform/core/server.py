"""Lightweight HTTP server for dbt commands inside Cloudflare Container.

Artifacts are saved to R2 via Outbound Workers.
Container sends HTTP to http://r2.worker/{key} → Worker's outboundByHost
intercepts and translates to R2 binding calls.
"""

import json
import os
import subprocess
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.request import Request, urlopen

R2_HOST = "http://r2.worker"


class DbtHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self._json_response(200, {"status": "ok"})
        else:
            self._json_response(404, {"error": "not found"})

    def do_POST(self):
        if self.path in ("/run", "/seed", "/test", "/build"):
            self._run_dbt(self.path.lstrip("/"))
        else:
            self._json_response(404, {"error": "not found"})

    def _run_dbt(self, command: str):
        content_length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(content_length)) if content_length > 0 else {}

        target = body.get("target", "dev")
        select = body.get("select", None)
        full_refresh = body.get("full_refresh", False)

        cmd = ["uv", "run", "dbt", command, "--target", target, "--profiles-dir", "."]
        if select:
            cmd.extend(["--select", select])
        if full_refresh:
            cmd.append("--full-refresh")

        result = subprocess.run(cmd, capture_output=True, text=True, cwd="/app")

        artifacts_saved: list[str] = []
        if result.returncode == 0 and command in ("run", "build"):
            artifacts_saved = self._save_artifacts_to_r2()

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

    def _save_artifacts_to_r2(self) -> list[str]:
        """Upload dbt artifacts to R2 via Outbound Workers."""
        saved = []
        artifact_files = [
            "target/manifest.json",
            "target/run_results.json",
            "target/catalog.json",
            "target/sources.json",
        ]
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

        for artifact in artifact_files:
            src = os.path.join("/app", artifact)
            if not os.path.exists(src):
                continue

            filename = os.path.basename(artifact)

            with open(src, "rb") as f:
                data = f.read()

            # PUT to latest/
            self._put_r2(f"dbt-core/latest/{filename}", data)
            # PUT to history/{timestamp}/
            self._put_r2(f"dbt-core/history/{timestamp}/{filename}", data)
            saved.append(filename)

        return saved

    def _put_r2(self, key: str, data: bytes):
        """PUT object to R2 via Outbound Worker at http://r2.worker."""
        req = Request(
            f"{R2_HOST}/{key}",
            data=data,
            method="PUT",
            headers={"Content-Type": "application/json"},
        )
        try:
            urlopen(req)
        except Exception as e:
            print(f"Failed to PUT {key} to R2: {e}")

    def _json_response(self, status: int, body: dict):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    server = HTTPServer(("0.0.0.0", port), DbtHandler)
    print(f"dbt-runner server listening on port {port}")
    server.serve_forever()
