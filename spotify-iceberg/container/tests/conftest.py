import os
import sys
from pathlib import Path

# Ensure src/ is importable in tests
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

# Default test env vars so module-level os.environ reads don't fail
os.environ.setdefault("SPOTIFY_CLIENT_ID", "test-client-id")
os.environ.setdefault("SPOTIFY_CLIENT_SECRET", "test-client-secret")
os.environ.setdefault("R2_CATALOG_URI", "http://localhost/catalog")
os.environ.setdefault("R2_CATALOG_TOKEN", "test-token")
os.environ.setdefault("R2_CATALOG_WAREHOUSE", "test-warehouse")
os.environ.setdefault("R2_ENDPOINT", "http://localhost:9000")
os.environ.setdefault("R2_ACCESS_KEY_ID", "test-key")
os.environ.setdefault("R2_SECRET_ACCESS_KEY", "test-secret")

import pytest
from pyiceberg.catalog import Catalog
from pyiceberg.catalog.rest import RestCatalog
from pyiceberg.catalog.sql import SqlCatalog


@pytest.fixture(autouse=True)
def _no_rest_catalog_network(monkeypatch) -> None:
    """Prevent RestCatalog.__init__ from making real network calls in tests.

    RestCatalog._fetch_config() is invoked during construction and performs an
    HTTP request to the catalog server.  Patching it to a no-op lets tests that
    exercise main.py's /run endpoint instantiate RestCatalog without a live
    server, while all other catalog behaviour remains intact.
    """
    monkeypatch.setattr(RestCatalog, "_fetch_config", lambda self: None)


@pytest.fixture
def local_catalog(tmp_path) -> Catalog:
    warehouse = tmp_path / "warehouse"
    warehouse.mkdir()
    catalog = SqlCatalog(
        "test",
        **{
            "uri": f"sqlite:///{tmp_path}/catalog.db",
            "warehouse": f"file://{warehouse}",
        },
    )
    return catalog
