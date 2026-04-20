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
