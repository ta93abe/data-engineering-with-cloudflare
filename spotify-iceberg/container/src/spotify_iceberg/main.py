from __future__ import annotations

import logging
from dataclasses import asdict

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pyiceberg.catalog.rest import RestCatalog

from .config import Settings
from .pipeline import run_recently_played
from .spotify import SpotifyClient
from .state import StateStore

logger = logging.getLogger("spotify_iceberg")
logging.basicConfig(level=logging.INFO, format="%(message)s")

app = FastAPI(title="spotify-iceberg")


def _build_catalog(settings: Settings) -> RestCatalog:
    return RestCatalog(
        "r2",
        **{
            "uri": settings.r2_catalog_uri,
            "token": settings.r2_catalog_token,
            "warehouse": settings.r2_catalog_warehouse,
            "s3.endpoint": settings.r2_endpoint,
            "s3.access-key-id": settings.r2_access_key_id,
            "s3.secret-access-key": settings.r2_secret_access_key,
            "s3.region": "auto",
        },
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/run")
def run() -> JSONResponse:
    try:
        settings = Settings()
        state = StateStore(base_url=settings.kv_base_url)
        spotify = SpotifyClient(
            client_id=settings.spotify_client_id,
            client_secret=settings.spotify_client_secret,
        )
        catalog = _build_catalog(settings)
        result = run_recently_played(
            state=state,
            spotify=spotify,
            catalog=catalog,
            first_run_lookback_ms=settings.first_run_lookback_ms,
        )
    except Exception as exc:
        logger.exception("pipeline failed")
        return JSONResponse({"error": str(exc)}, status_code=500)

    logger.info("pipeline ok rows=%s cursor=%s", result.rows_written, result.new_cursor_ms)
    return JSONResponse(asdict(result))
