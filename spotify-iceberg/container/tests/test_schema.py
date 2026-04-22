from __future__ import annotations

from spotify_iceberg.schema import (
    PARTITION_SPEC,
    RECENTLY_PLAYED_SCHEMA,
    SORT_ORDER,
)


def test_schema_has_expected_top_level_fields() -> None:
    names = [f.name for f in RECENTLY_PLAYED_SCHEMA.fields]
    assert names == [
        "played_at",
        "played_at_ms",
        "track",
        "context",
        "_raw_json",
        "_ingested_at",
    ]


def test_required_fields() -> None:
    required_names = {f.name for f in RECENTLY_PLAYED_SCHEMA.fields if f.required}
    assert required_names == {
        "played_at",
        "played_at_ms",
        "track",
        "_raw_json",
        "_ingested_at",
    }


def test_artists_is_required_list() -> None:
    track = RECENTLY_PLAYED_SCHEMA.find_field("track").field_type
    artists = track.field_by_name("artists")
    assert artists.required is True


def test_partition_spec_uses_day_transform() -> None:
    assert len(PARTITION_SPEC.fields) == 1
    assert PARTITION_SPEC.fields[0].name == "played_at_day"


def test_sort_order_sorts_by_played_at() -> None:
    assert len(SORT_ORDER.fields) == 1
    assert SORT_ORDER.fields[0].source_id == 1


def test_track_id_is_nullable() -> None:
    track = RECENTLY_PLAYED_SCHEMA.find_field("track").field_type
    track_id = track.field_by_name("id")
    assert track_id.required is False
