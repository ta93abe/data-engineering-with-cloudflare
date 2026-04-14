# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "pyiceberg[pyarrow]>=0.9.1",
#     "pyarrow>=18.0.0",
#     "python-dotenv>=1.0.1",
# ]
# ///
"""Load transform/fusion/seeds/*.csv into R2 Data Catalog as Iceberg tables.

Tables are written to the `seeds` namespace and can be queried from Snowflake
as `r2_lakehouse.seeds.<table_name>` once the catalog-linked database polls
the catalog (default ~30s).

Required environment variables:
    R2_CATALOG_URI         wrangler r2 bucket catalog get <BUCKET> の catalogUri
    R2_CATALOG_WAREHOUSE   同 warehouseName (通常 <ACCOUNT_ID>_<BUCKET>)
    R2_CATALOG_TOKEN       Cloudflare API token (Workers R2 Data Catalog Read+Write)

Note: R2 Data Catalog uses *vended credentials* — the catalog itself issues
short-lived S3 credentials per table, so no standalone S3 access key is
required when writing through the Iceberg REST client.

Usage:
    uv run scripts/load_seeds_to_r2.py
    uv run scripts/load_seeds_to_r2.py --dry-run
    uv run scripts/load_seeds_to_r2.py --only raw_airlines raw_hotels
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import pyarrow as pa
import pyarrow.csv as pa_csv
from dotenv import load_dotenv
from pyiceberg.catalog.rest import RestCatalog
from pyiceberg.exceptions import NamespaceAlreadyExistsError, NoSuchTableError
from pyiceberg.exceptions import RESTError

# R2 Data Catalog rate-limits create/delete operations; pause briefly between
# writes. Tune via --sleep if you hit 429s.
DEFAULT_OP_SLEEP_SECONDS = 2.0
RATE_LIMIT_BACKOFF_SECONDS = 30.0
RATE_LIMIT_MAX_RETRIES = 4

REPO_ROOT = Path(__file__).resolve().parent.parent
NAMESPACE = "seeds"
SEEDS_DIR = REPO_ROOT / "transform" / "fusion" / "seeds"

load_dotenv(REPO_ROOT / ".env", override=True)


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"error: required environment variable {name} is not set")
    return value


def build_catalog() -> RestCatalog:
    return RestCatalog(
        name="r2",
        warehouse=require_env("R2_CATALOG_WAREHOUSE"),
        uri=require_env("R2_CATALOG_URI"),
        token=require_env("R2_CATALOG_TOKEN"),
    )


def ensure_namespace(catalog) -> None:
    try:
        catalog.create_namespace(NAMESPACE)
        print(f"+ created namespace '{NAMESPACE}'")
    except NamespaceAlreadyExistsError:
        print(f"= namespace '{NAMESPACE}' already exists")


def _downcast_nanosecond_timestamps(table: pa.Table) -> pa.Table:
    """Iceberg only supports up to microsecond timestamp precision.

    pyarrow's CSV reader defaults to `timestamp[ns]`, which pyiceberg rejects.
    Cast any nanosecond timestamp columns to microseconds, preserving timezone.
    """
    new_fields = []
    cast_needed = False
    for field in table.schema:
        if pa.types.is_timestamp(field.type) and field.type.unit == "ns":
            cast_needed = True
            new_fields.append(field.with_type(pa.timestamp("us", tz=field.type.tz)))
        else:
            new_fields.append(field)
    if not cast_needed:
        return table
    return table.cast(pa.schema(new_fields))


def load_csv(path: Path) -> pa.Table:
    # Let pyarrow auto-infer types; seeds are small enough that this is fine.
    table = pa_csv.read_csv(path)
    return _downcast_nanosecond_timestamps(table)


def _retry_on_rate_limit(fn, label: str):
    for attempt in range(1, RATE_LIMIT_MAX_RETRIES + 1):
        try:
            return fn()
        except RESTError as exc:
            if "TooManyRequestsException" not in str(exc) and "429" not in str(exc):
                raise
            wait = RATE_LIMIT_BACKOFF_SECONDS * attempt
            print(
                f"   ! rate-limited on {label} (attempt {attempt}/{RATE_LIMIT_MAX_RETRIES}); "
                f"sleeping {wait:.0f}s"
            )
            time.sleep(wait)
    raise RuntimeError(f"rate limit exceeded after {RATE_LIMIT_MAX_RETRIES} retries on {label}")


def upsert_table(catalog, table_name: str, arrow_table, skip_existing: bool) -> str:
    identifier = (NAMESPACE, table_name)
    try:
        table = catalog.load_table(identifier)
        if skip_existing:
            return "skipped"
        _retry_on_rate_limit(lambda: table.overwrite(arrow_table), f"overwrite {table_name}")
        return "overwrote"
    except NoSuchTableError:
        table = _retry_on_rate_limit(
            lambda: catalog.create_table(identifier, schema=arrow_table.schema),
            f"create {table_name}",
        )
        _retry_on_rate_limit(lambda: table.append(arrow_table), f"append {table_name}")
        return "created"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="list what would be loaded without writing",
    )
    parser.add_argument(
        "--only",
        nargs="+",
        metavar="TABLE",
        help="only load the given table names (without .csv extension)",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="skip tables that already exist (resume-friendly after a 429)",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=DEFAULT_OP_SLEEP_SECONDS,
        help=f"seconds to pause between tables (default: {DEFAULT_OP_SLEEP_SECONDS})",
    )
    args = parser.parse_args()

    if not SEEDS_DIR.is_dir():
        sys.exit(f"error: seeds dir not found: {SEEDS_DIR}")

    csv_paths = sorted(SEEDS_DIR.glob("*.csv"))
    if args.only:
        wanted = set(args.only)
        csv_paths = [p for p in csv_paths if p.stem in wanted]
        missing = wanted - {p.stem for p in csv_paths}
        if missing:
            sys.exit(f"error: requested tables not found: {sorted(missing)}")

    if not csv_paths:
        sys.exit("error: no CSV files to load")

    print(f"found {len(csv_paths)} CSV file(s) under {SEEDS_DIR}")
    for p in csv_paths:
        print(f"  - {p.name}")

    if args.dry_run:
        print("dry-run: not writing to R2 Data Catalog")
        return 0

    catalog = build_catalog()
    ensure_namespace(catalog)

    for i, path in enumerate(csv_paths):
        table_name = path.stem
        arrow_table = load_csv(path)
        action = upsert_table(catalog, table_name, arrow_table, args.skip_existing)
        print(
            f"{action:>9} {NAMESPACE}.{table_name} "
            f"({arrow_table.num_rows} rows, {arrow_table.num_columns} cols)"
        )
        if args.sleep > 0 and i < len(csv_paths) - 1:
            time.sleep(args.sleep)

    print("done. Snowflake will auto-sync via the catalog-linked database.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
