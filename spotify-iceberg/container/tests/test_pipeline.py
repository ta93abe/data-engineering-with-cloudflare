from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from spotify_iceberg.pipeline import PipelineResult, run_recently_played
from spotify_iceberg.spotify import TokenResult


FIXTURE = Path(__file__).parent / "fixtures" / "recently_played_sample.json"


@pytest.fixture
def sample_items() -> list[dict]:
    return json.loads(FIXTURE.read_text())["items"]


def _fixed_now() -> datetime:
    return datetime(2026, 4, 20, 10, 5, 0, tzinfo=timezone.utc)


def test_run_recently_played_happy_path(sample_items, local_catalog) -> None:
    state = MagicMock()
    state.get.side_effect = lambda k: {
        "refresh_token": "rt-initial",
        "cursor": "1713500000000",
    }.get(k)

    spotify = MagicMock()
    spotify.refresh_access_token.return_value = TokenResult(
        access_token="at-123", refresh_token="rt-initial"
    )
    spotify.recently_played.return_value = sample_items

    result = run_recently_played(
        state=state,
        spotify=spotify,
        catalog=local_catalog,
        now=_fixed_now,
        first_run_lookback_ms=60 * 60 * 1000,
    )

    assert isinstance(result, PipelineResult)
    assert result.rows_written == len(sample_items)
    state.put.assert_any_call(
        "cursor",
        str(int(datetime(2026, 4, 20, 10, 0, 0, tzinfo=timezone.utc).timestamp() * 1000)),
    )
    refresh_puts = [c for c in state.put.call_args_list if c.args[0] == "refresh_token"]
    assert refresh_puts == []


# ---------------------------------------------------------------------------
# Edge-case tests: bootstrap (first run), zero items, token rotation,
# missing refresh_token (G2)
# ---------------------------------------------------------------------------


def test_run_recently_played_first_run_uses_lookback(local_catalog) -> None:
    state = MagicMock()
    state.get.side_effect = lambda k: {"refresh_token": "rt-initial"}.get(k)
    spotify = MagicMock()
    spotify.refresh_access_token.return_value = TokenResult(
        access_token="at-123", refresh_token="rt-initial"
    )
    spotify.recently_played.return_value = []

    run_recently_played(
        state=state,
        spotify=spotify,
        catalog=local_catalog,
        now=_fixed_now,
        first_run_lookback_ms=60 * 60 * 1000,
    )

    fixed_now_ms = int(_fixed_now().timestamp() * 1000)
    expected_after_ms = fixed_now_ms - 60 * 60 * 1000
    spotify.recently_played.assert_called_once_with("at-123", after_ms=expected_after_ms)


def test_run_recently_played_zero_items_preserves_cursor(local_catalog) -> None:
    state = MagicMock()
    state.get.side_effect = lambda k: {
        "refresh_token": "rt-initial",
        "cursor": "1713500000000",
    }.get(k)
    spotify = MagicMock()
    spotify.refresh_access_token.return_value = TokenResult(
        access_token="at-123", refresh_token="rt-initial"
    )
    spotify.recently_played.return_value = []

    result = run_recently_played(
        state=state, spotify=spotify, catalog=local_catalog, now=_fixed_now,
    )
    assert result.rows_written == 0
    cursor_puts = [c for c in state.put.call_args_list if c.args[0] == "cursor"]
    assert cursor_puts == []


def test_run_recently_played_rotates_refresh_token(sample_items, local_catalog) -> None:
    state = MagicMock()
    state.get.side_effect = lambda k: {
        "refresh_token": "rt-old",
        "cursor": "1713500000000",
    }.get(k)
    spotify = MagicMock()
    spotify.refresh_access_token.return_value = TokenResult(
        access_token="at-123", refresh_token="rt-new"
    )
    spotify.recently_played.return_value = sample_items

    run_recently_played(
        state=state, spotify=spotify, catalog=local_catalog, now=_fixed_now,
    )
    state.put.assert_any_call("refresh_token", "rt-new")


def test_run_recently_played_raises_without_refresh_token(local_catalog) -> None:
    state = MagicMock()
    state.get.return_value = None
    spotify = MagicMock()

    with pytest.raises(RuntimeError, match="refresh_token not found"):
        run_recently_played(
            state=state, spotify=spotify, catalog=local_catalog, now=_fixed_now,
        )
