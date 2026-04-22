from __future__ import annotations

from unittest.mock import patch

from fastapi.testclient import TestClient

from spotify_iceberg.main import app
from spotify_iceberg.pipeline import PipelineResult


def test_run_returns_pipeline_result() -> None:
    with patch("spotify_iceberg.main.run_recently_played") as mock_run:
        mock_run.return_value = PipelineResult(
            rows_written=3,
            new_cursor_ms=1713500400000,
            snapshot_id=4242,
        )
        client = TestClient(app)
        resp = client.post("/run")

    assert resp.status_code == 200
    body = resp.json()
    assert body["rows_written"] == 3
    assert body["new_cursor_ms"] == 1713500400000
    assert body["snapshot_id"] == 4242


def test_run_surfaces_errors_as_500() -> None:
    with patch("spotify_iceberg.main.run_recently_played", side_effect=RuntimeError("boom")):
        client = TestClient(app)
        resp = client.post("/run")
    assert resp.status_code == 500
    assert "boom" in resp.json()["error"]
