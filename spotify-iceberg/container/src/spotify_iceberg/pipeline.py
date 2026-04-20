from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

from pyiceberg.catalog import Catalog

from .iceberg_writer import AppendResult, append_items
from .spotify import SpotifyClient
from .state import StateStore

TABLE_IDENTIFIER: tuple[str, str] = ("spotify", "recently_played")


@dataclass(frozen=True)
class PipelineResult:
    rows_written: int
    new_cursor_ms: int | None
    snapshot_id: int | None


def run_recently_played(
    *,
    state: StateStore,
    spotify: SpotifyClient,
    catalog: Catalog,
    now: Callable[[], datetime] = lambda: datetime.now(tz=timezone.utc),
    first_run_lookback_ms: int = 60 * 60 * 1000,
) -> PipelineResult:
    refresh_token = state.get("refresh_token")
    if refresh_token is None:
        raise RuntimeError(
            "refresh_token not found in KV — run scripts/get_refresh_token.py "
            "and load the value with `wrangler kv key put`"
        )

    token = spotify.refresh_access_token(refresh_token)
    if token.refresh_token != refresh_token:
        state.put("refresh_token", token.refresh_token)

    cursor_str = state.get("cursor")
    if cursor_str is None:
        after_ms = int(now().timestamp() * 1000) - first_run_lookback_ms
    else:
        after_ms = int(cursor_str)

    items = spotify.recently_played(token.access_token, after_ms=after_ms)
    if not items:
        return PipelineResult(rows_written=0, new_cursor_ms=None, snapshot_id=None)

    append_result: AppendResult = append_items(
        catalog,
        TABLE_IDENTIFIER,
        items,
        ingested_at=now(),
    )

    latest_ms = max(_played_at_ms(item) for item in items)
    state.put("cursor", str(latest_ms))

    return PipelineResult(
        rows_written=append_result.rows_written,
        new_cursor_ms=latest_ms,
        snapshot_id=append_result.snapshot_id,
    )


def _played_at_ms(item: dict) -> int:
    ts = item["played_at"]
    if ts.endswith("Z"):
        ts = ts[:-1] + "+00:00"
    return int(datetime.fromisoformat(ts).timestamp() * 1000)
