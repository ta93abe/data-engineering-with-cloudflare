"""
Iceberg schema for the spotify.recently_played table.

The schema mirrors the Spotify API item structure (fully nested) with two
audit columns appended. Transformation/flatten is deferred to dbt.
"""
from __future__ import annotations

from pyiceberg.partitioning import PartitionField, PartitionSpec
from pyiceberg.schema import Schema
from pyiceberg.table.sorting import SortField, SortOrder
from pyiceberg.transforms import DayTransform, IdentityTransform
from pyiceberg.types import (
    BooleanType,
    IntegerType,
    ListType,
    LongType,
    NestedField,
    StringType,
    StructType,
    TimestamptzType,
)

ARTIST_STRUCT = StructType(
    NestedField(101, "id", StringType(), required=True),
    NestedField(102, "name", StringType(), required=True),
    NestedField(103, "uri", StringType(), required=False),
)

ALBUM_STRUCT = StructType(
    NestedField(201, "id", StringType(), required=True),
    NestedField(202, "name", StringType(), required=True),
    NestedField(203, "uri", StringType(), required=False),
    NestedField(204, "album_type", StringType(), required=False),
    NestedField(205, "release_date", StringType(), required=False),
    NestedField(206, "total_tracks", IntegerType(), required=False),
)

TRACK_STRUCT = StructType(
    NestedField(301, "id", StringType(), required=True),
    NestedField(302, "name", StringType(), required=True),
    NestedField(303, "uri", StringType(), required=False),
    NestedField(304, "duration_ms", IntegerType(), required=False),
    NestedField(305, "explicit", BooleanType(), required=False),
    NestedField(306, "popularity", IntegerType(), required=False),
    NestedField(307, "isrc", StringType(), required=False),
    NestedField(308, "album", ALBUM_STRUCT, required=False),
    NestedField(
        field_id=309,
        name="artists",
        field_type=ListType(
            element_id=310,
            element_type=ARTIST_STRUCT,
            element_required=True,
        ),
        required=True,
    ),
)

CONTEXT_STRUCT = StructType(
    NestedField(401, "type", StringType(), required=False),
    NestedField(402, "uri", StringType(), required=False),
)

RECENTLY_PLAYED_SCHEMA = Schema(
    NestedField(1, "played_at", TimestamptzType(), required=True),
    NestedField(2, "played_at_ms", LongType(), required=True),
    NestedField(3, "track", TRACK_STRUCT, required=True),
    NestedField(4, "context", CONTEXT_STRUCT, required=False),
    NestedField(5, "_raw_json", StringType(), required=True),
    NestedField(6, "_ingested_at", TimestamptzType(), required=True),
    identifier_field_ids=[1, 301],
)

PARTITION_SPEC = PartitionSpec(
    PartitionField(
        source_id=1,
        field_id=1000,
        transform=DayTransform(),
        name="played_at_day",
    ),
)

SORT_ORDER = SortOrder(
    SortField(source_id=1, transform=IdentityTransform()),
)

TABLE_PROPERTIES = {
    "write.format.default": "parquet",
    "write.parquet.compression-codec": "zstd",
    "format-version": "2",
}
