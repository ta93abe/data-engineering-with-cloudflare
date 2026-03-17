"""dlt pipeline: GitHub → R2 Iceberg (via R2 Data Catalog)

Loads issues, pull requests, comments, reactions, events, and stargazers
from all public repos of a GitHub user into Iceberg tables on R2.

Uses filesystem destination with table_format="iceberg" and PyIceberg
catalog pointing to R2 Data Catalog (REST).

Tables are partitioned by month(created_at) for R2 SQL compatibility.
A `repo_name` column is injected to identify which repository data belongs to.
"""

import dlt
import requests

from github import github_reactions, github_repo_events

GITHUB_OWNER = "ta93abe"


def get_public_repos(owner: str, token: str) -> list[str]:
    """Fetch all non-fork public repository names for a GitHub user."""
    repos: list[str] = []
    page = 1
    while True:
        resp = requests.get(
            f"https://api.github.com/users/{owner}/repos",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
            },
            params={"type": "public", "per_page": 100, "page": page},
        )
        resp.raise_for_status()
        data = resp.json()
        if not data:
            break
        repos.extend(r["name"] for r in data if not r.get("fork"))
        page += 1
    return repos


def add_repo_name(repo_name: str):
    """Returns a map function that injects repo_name into each record."""
    def _add(record):
        record["repo_name"] = repo_name
        return record
    return _add


def apply_iceberg(resource):
    """Apply iceberg table format to a resource."""
    resource.apply_hints(table_format="iceberg")
    return resource


def ensure_partitions(catalog, namespace: str = "github"):
    """Add month(created_at) partition to any unpartitioned tables."""
    from pyiceberg.transforms import MonthTransform
    from pyiceberg.partitioning import PartitionSpec, PartitionField

    for table_id in catalog.list_tables(namespace):
        table = catalog.load_table(table_id)
        if table.spec().is_unpartitioned():
            try:
                created_at = table.schema().find_field("created_at")
            except Exception:
                print(f"  {table_id[1]}: no created_at field, skipping partition")
                continue

            with table.update_spec() as update:
                update.add_field("created_at", MonthTransform(), "created_at_month")
            print(f"  {table_id[1]}: added month(created_at) partition")
        else:
            print(f"  {table_id[1]}: already partitioned")


def get_catalog():
    """Create PyIceberg REST catalog for R2 Data Catalog."""
    from pyiceberg.catalog.rest import RestCatalog

    return RestCatalog(
        name="r2",
        **dlt.secrets["iceberg_catalog.iceberg_catalog_config"],
    )


def run() -> None:
    pipeline = dlt.pipeline(
        pipeline_name="github_to_iceberg",
        destination="filesystem",
        dataset_name="github",
    )

    token = dlt.secrets["sources.github.access_token"]
    repos = get_public_repos(GITHUB_OWNER, token)
    print(f"Found {len(repos)} public repos for {GITHUB_OWNER}")

    for repo_name in repos:
        print(f"\n--- {GITHUB_OWNER}/{repo_name} ---")

        # Issues, PRs, comments, reactions
        try:
            data = github_reactions(
                GITHUB_OWNER, repo_name, items_per_page=100
            )
            data.issues.add_map(add_repo_name(repo_name))
            data.pull_requests.add_map(add_repo_name(repo_name))
            apply_iceberg(data.issues)
            apply_iceberg(data.pull_requests)

            info = pipeline.run(data)
            print(f"  reactions: {info}")
        except Exception as e:
            print(f"  reactions failed: {e}")

        # Repo events (incremental)
        try:
            data = github_repo_events(GITHUB_OWNER, repo_name)
            data.repo_events.add_map(add_repo_name(repo_name))
            apply_iceberg(data.repo_events)
            info = pipeline.run(data)
            print(f"  events: {info}")
        except Exception as e:
            print(f"  events failed: {e}")

    # Post-load: add partitions to any unpartitioned tables
    print("\n--- Ensuring partitions ---")
    catalog = get_catalog()
    ensure_partitions(catalog)

    print("\nPipeline complete!")


if __name__ == "__main__":
    run()
