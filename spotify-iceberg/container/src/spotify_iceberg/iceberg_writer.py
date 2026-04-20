from __future__ import annotations

import json
from datetime import datetime

import pyarrow as pa
from pyiceberg.catalog import Catalog
from pyiceberg.io.pyarrow import schema_to_pyarrow
from pyiceberg.table import Table

from .schema import PARTITION_SPEC, RECENTLY_PLAYED_SCHEMA, SORT_ORDER, TABLE_PROPERTIES

# Derive the Arrow schema directly from the Iceberg schema so that nullability
# and field metadata match exactly what PyIceberg expects on append.
_ARROW_SCHEMA: pa.Schema = schema_to_pyarrow(RECENTLY_PLAYED_SCHEMA)


def _parse_iso_utc(ts: str) -> datetime:
    if ts.endswith("Z"):
        ts = ts[:-1] + "+00:00"
    return datetime.fromisoformat(ts)


def _build_artist(artist: dict) -> dict:
    return {"id": artist["id"], "name": artist["name"], "uri": artist.get("uri")}


def _build_album(album: dict | None) -> dict | None:
    if album is None:
        return None
    return {
        "id": album["id"],
        "name": album["name"],
        "uri": album.get("uri"),
        "album_type": album.get("album_type"),
        "release_date": album.get("release_date"),
        "total_tracks": album.get("total_tracks"),
    }


def _build_track(track: dict) -> dict:
    return {
        "id": track["id"],
        "name": track["name"],
        "uri": track.get("uri"),
        "duration_ms": track.get("duration_ms"),
        "explicit": track.get("explicit"),
        "popularity": track.get("popularity"),
        "isrc": (track.get("external_ids") or {}).get("isrc"),
        "album": _build_album(track.get("album")),
        "artists": [_build_artist(a) for a in track.get("artists", [])],
    }


def _build_context(context: dict | None) -> dict | None:
    if context is None:
        return None
    return {"type": context.get("type"), "uri": context.get("uri")}


def build_arrow_table(items: list[dict], ingested_at: datetime) -> pa.Table:
    """Convert Spotify recently-played items into a pyarrow.Table matching schema.py."""
    rows = []
    for item in items:
        played_at = _parse_iso_utc(item["played_at"])
        rows.append(
            {
                "played_at": played_at,
                "played_at_ms": int(played_at.timestamp() * 1000),
                "track": _build_track(item["track"]),
                "context": _build_context(item.get("context")),
                "_raw_json": json.dumps(item, separators=(",", ":")),
                "_ingested_at": ingested_at,
            }
        )
    return pa.Table.from_pylist(rows, schema=_ARROW_SCHEMA)


def ensure_table(catalog: Catalog, identifier: tuple[str, str]) -> Table:
    namespace, _ = identifier
    if (namespace,) not in catalog.list_namespaces():
        catalog.create_namespace(namespace)
    try:
        return catalog.load_table(identifier)
    except Exception:
        return catalog.create_table(
            identifier=identifier,
            schema=RECENTLY_PLAYED_SCHEMA,
            partition_spec=PARTITION_SPEC,
            sort_order=SORT_ORDER,
            properties=TABLE_PROPERTIES,
        )
