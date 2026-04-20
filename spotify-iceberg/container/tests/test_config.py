from __future__ import annotations

import pytest

from spotify_iceberg.config import Settings


def test_settings_reads_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SPOTIFY_CLIENT_ID", "cid")
    monkeypatch.setenv("SPOTIFY_CLIENT_SECRET", "csec")
    monkeypatch.setenv("R2_CATALOG_URI", "https://cat/uri")
    monkeypatch.setenv("R2_CATALOG_TOKEN", "tok")
    monkeypatch.setenv("R2_CATALOG_WAREHOUSE", "wh")
    monkeypatch.setenv("R2_ENDPOINT", "https://r2/ep")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "ak")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "sk")

    s = Settings()
    assert s.spotify_client_id == "cid"
    assert s.r2_catalog_uri == "https://cat/uri"
    assert s.kv_base_url == "http://kv.internal"
    assert s.first_run_lookback_ms == 60 * 60 * 1000
