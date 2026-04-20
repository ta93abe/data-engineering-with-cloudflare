from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from pyiceberg.catalog import Catalog

from spotify_iceberg.iceberg_writer import build_arrow_table, ensure_table

FIXTURE = Path(__file__).parent / "fixtures" / "recently_played_sample.json"


@pytest.fixture
def sample_items() -> list[dict]:
    return json.loads(FIXTURE.read_text())["items"]


def test_build_arrow_table_has_expected_columns(sample_items) -> None:
    table = build_arrow_table(
        sample_items,
        ingested_at=datetime(2026, 4, 20, 10, 5, 0, tzinfo=UTC),
    )
    assert set(table.column_names) == {
        "played_at",
        "played_at_ms",
        "track",
        "context",
        "_raw_json",
        "_ingested_at",
    }


def test_build_arrow_table_preserves_played_at_ms(sample_items) -> None:
    table = build_arrow_table(
        sample_items,
        ingested_at=datetime(2026, 4, 20, 10, 5, 0, tzinfo=UTC),
    )
    played_at_ms = table.column("played_at_ms")[0].as_py()
    expected = int(datetime(2026, 4, 20, 10, 0, 0, tzinfo=UTC).timestamp() * 1000)
    assert played_at_ms == expected


def test_build_arrow_table_keeps_raw_json(sample_items) -> None:
    table = build_arrow_table(
        sample_items,
        ingested_at=datetime(2026, 4, 20, 10, 5, 0, tzinfo=UTC),
    )
    raw = table.column("_raw_json")[0].as_py()
    parsed = json.loads(raw)
    assert parsed["track"]["id"] == sample_items[0]["track"]["id"]


def test_build_arrow_table_extracts_isrc(sample_items) -> None:
    table = build_arrow_table(
        sample_items,
        ingested_at=datetime(2026, 4, 20, 10, 5, 0, tzinfo=UTC),
    )
    track = table.column("track")[0].as_py()
    assert track["isrc"] == "USUM71703861"


def test_build_arrow_table_handles_null_context() -> None:
    items = [
        {
            "track": {"id": "t1", "name": "n1", "artists": [{"id": "a1", "name": "an1"}]},
            "played_at": "2026-04-20T11:00:00.000Z",
            "context": None,
        }
    ]
    table = build_arrow_table(
        items, ingested_at=datetime(2026, 4, 20, 11, 1, 0, tzinfo=UTC)
    )
    assert table.column("context")[0].as_py() is None


def test_ensure_table_creates_namespace_and_table(local_catalog: Catalog) -> None:
    table = ensure_table(local_catalog, ("spotify", "recently_played"))
    # PyIceberg 0.11.x: table.identifier does not exist; use table.name()
    assert table.name()[-2:] == ("spotify", "recently_played")
    again = ensure_table(local_catalog, ("spotify", "recently_played"))
    assert again.metadata.table_uuid == table.metadata.table_uuid


def test_ensure_table_schema_matches(local_catalog: Catalog) -> None:
    table = ensure_table(local_catalog, ("spotify", "recently_played"))
    names = [f.name for f in table.schema().fields]
    assert "played_at" in names
    assert "_raw_json" in names
