from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-driven configuration. Reads from os.environ."""

    spotify_client_id: str
    spotify_client_secret: str
    r2_catalog_uri: str
    r2_catalog_token: str
    r2_catalog_warehouse: str
    r2_endpoint: str
    r2_access_key_id: str
    r2_secret_access_key: str

    kv_base_url: str = "http://kv.internal"
    first_run_lookback_ms: int = 60 * 60 * 1000  # 1 hour

    model_config = SettingsConfigDict(case_sensitive=False)
