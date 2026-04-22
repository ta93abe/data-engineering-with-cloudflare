# Spotify → R2 Iceberg Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [Linear TA-469](https://linear.app/ta93abe/issue/TA-469/spotify-r2-iceberg-データパイプライン設計)

**Goal:** Build a Cloudflare Worker + Container pipeline that pulls Spotify recently-played history every hour and appends it to an Apache Iceberg table on R2 Data Catalog using PyIceberg.

**Architecture:** A thin TypeScript Worker receives the hourly cron, starts a Durable-Object-backed Container, and exposes the `SPOTIFY_STATE_KV` binding to the container via `outboundByHost` virtual hosts. The container (Python + FastAPI) orchestrates Spotify OAuth refresh, API polling with a `played_at_ms` cursor, PyArrow table construction, and a single `table.append()` commit to the Iceberg REST catalog. Transformation is left to dbt on Databricks — the Iceberg layer is raw-nested with a `_raw_json` safety column.

**Tech Stack:** TypeScript 5.7, `@cloudflare/containers` 0.2+, Hono, Vitest, Python 3.12, FastAPI, Uvicorn, `spotipy`, `pyiceberg[pyarrow,s3fs]`, `pyarrow`, `httpx`, pytest, uv, Biome, ruff.

---

## File Structure

```
spotify-iceberg/
├── README.md
├── worker/
│   ├── package.json
│   ├── tsconfig.json
│   ├── biome.json
│   ├── vitest.config.ts
│   ├── wrangler.jsonc
│   └── src/
│       ├── index.ts              # SpotifyContainer DO + scheduled + outbound
│       ├── env.d.ts              # Env type declaration
│       └── __tests__/
│           └── outbound.test.ts
├── container/
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── uv.lock
│   ├── src/
│   │   └── spotify_iceberg/
│   │       ├── __init__.py
│   │       ├── main.py           # FastAPI app
│   │       ├── pipeline.py       # run_recently_played()
│   │       ├── spotify.py        # Spotify API client
│   │       ├── schema.py         # PyIceberg Schema + PartitionSpec
│   │       ├── state.py          # KV outbound read/write (httpx)
│   │       ├── iceberg_writer.py # pyarrow → pyiceberg append
│   │       └── config.py         # env var loading
│   └── tests/
│       ├── conftest.py
│       ├── fixtures/
│       │   └── recently_played_sample.json
│       ├── test_schema.py
│       ├── test_spotify.py
│       ├── test_state.py
│       ├── test_iceberg_writer.py
│       └── test_pipeline.py

scripts/spotify/
└── get_refresh_token.py          # one-shot local OAuth helper (lives at repo root)
```

Each file has one responsibility:

- `worker/src/index.ts` — Cloudflare runtime entrypoints (scheduled, outbound, DO class)
- `container/src/spotify_iceberg/spotify.py` — HTTP against Spotify only; no Iceberg, no state
- `container/src/spotify_iceberg/iceberg_writer.py` — PyArrow+PyIceberg only; no Spotify, no KV
- `container/src/spotify_iceberg/state.py` — KV via outbound HTTP; no business logic
- `container/src/spotify_iceberg/pipeline.py` — glue between the three; retryable error boundaries
- `container/src/spotify_iceberg/main.py` — FastAPI shell; calls pipeline

---

## Phase A — Project scaffold

### Task A1: Create worker skeleton (package.json, tsconfig, biome, vitest, empty src)

**Files:**
- Create: `spotify-iceberg/worker/package.json`
- Create: `spotify-iceberg/worker/tsconfig.json`
- Create: `spotify-iceberg/worker/biome.json`
- Create: `spotify-iceberg/worker/vitest.config.ts`
- Create: `spotify-iceberg/worker/src/index.ts`
- Create: `spotify-iceberg/worker/src/env.d.ts`

- [ ] **Step 1: Create `spotify-iceberg/worker/package.json`**

```json
{
  "name": "spotify-iceberg-worker",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy --minify",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "test:run": "vitest run",
    "check": "biome check .",
    "check:fix": "biome check --write ."
  },
  "dependencies": {
    "@cloudflare/containers": "^0.2.0",
    "hono": "^4.11.7"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.3.13",
    "@cloudflare/vitest-pool-workers": "^0.8.0",
    "@cloudflare/workers-types": "^4.20260301.0",
    "typescript": "^5.7.0",
    "vitest": "~1.5.0",
    "wrangler": "^4.4.0"
  }
}
```

- [ ] **Step 2: Create `spotify-iceberg/worker/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"],
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `spotify-iceberg/worker/biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.3.13/schema.json",
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always",
      "trailingCommas": "es5"
    }
  }
}
```

- [ ] **Step 4: Create `spotify-iceberg/worker/vitest.config.ts`**

```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
  },
});
```

- [ ] **Step 5: Create `spotify-iceberg/worker/src/env.d.ts`**

```typescript
interface Env {
  SPOTIFY_STATE_KV: KVNamespace;
  SPOTIFY_CONTAINER: DurableObjectNamespace;
}
```

- [ ] **Step 6: Create `spotify-iceberg/worker/src/index.ts` placeholder**

```typescript
import { Container } from "@cloudflare/containers";

export class SpotifyContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "5m";
}

export default {
  async scheduled(_event, env, _ctx) {
    const id = env.SPOTIFY_CONTAINER.idFromName("spotify");
    const stub = env.SPOTIFY_CONTAINER.get(id);
    const res = await stub.fetch("http://container/health");
    console.log(`health: ${res.status}`);
  },
  async fetch(_request, _env) {
    return new Response("spotify-iceberg worker", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 7: Install deps and commit**

```bash
cd spotify-iceberg/worker && pnpm install
cd ../..
git add spotify-iceberg/worker
git commit -m "feat(spotify-iceberg): scaffold worker project"
```

Expected: `pnpm install` succeeds; commit created.

---

### Task A2: Container scaffold (pyproject, Dockerfile, empty main)

**Files:**
- Create: `spotify-iceberg/container/pyproject.toml`
- Create: `spotify-iceberg/container/Dockerfile`
- Create: `spotify-iceberg/container/src/spotify_iceberg/__init__.py`
- Create: `spotify-iceberg/container/src/spotify_iceberg/main.py`
- Create: `spotify-iceberg/container/tests/__init__.py`
- Create: `spotify-iceberg/container/tests/conftest.py`

- [ ] **Step 1: Create `spotify-iceberg/container/pyproject.toml`**

```toml
[project]
name = "spotify-iceberg"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.110",
  "uvicorn[standard]>=0.27",
  "spotipy>=2.24",
  "pyiceberg[pyarrow,s3fs,sql-sqlite]>=0.7",
  "pyarrow>=17",
  "httpx>=0.27",
  "pydantic-settings>=2.0",
]

[project.optional-dependencies]
dev = [
  "pytest>=8.0",
  "pytest-asyncio>=0.23",
  "respx>=0.21",
  "ruff>=0.4",
]

[tool.hatch.build.targets.wheel]
packages = ["src/spotify_iceberg"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
pythonpath = ["src"]

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "W", "UP", "B"]
```

- [ ] **Step 2: Create `spotify-iceberg/container/Dockerfile`**

```dockerfile
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock* ./
COPY src ./src
RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:${PATH}"
EXPOSE 8080
CMD ["uvicorn", "spotify_iceberg.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

- [ ] **Step 3: Create `spotify-iceberg/container/src/spotify_iceberg/__init__.py`**

```python
__version__ = "0.1.0"
```

- [ ] **Step 4: Create `spotify-iceberg/container/src/spotify_iceberg/main.py` minimal**

```python
from fastapi import FastAPI

app = FastAPI(title="spotify-iceberg")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 5: Create `spotify-iceberg/container/tests/__init__.py` (empty) and `conftest.py`**

`conftest.py`:

```python
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
```

- [ ] **Step 6: Lock and install**

```bash
cd spotify-iceberg/container
uv sync --extra dev
```

Expected: `uv.lock` created, `.venv` populated with all deps.

- [ ] **Step 7: Commit**

```bash
cd ../..
git add spotify-iceberg/container
git commit -m "feat(spotify-iceberg): scaffold container project"
```

---

### Task A3: Health endpoint test (container)

**Files:**
- Create: `spotify-iceberg/container/tests/test_main.py`

- [ ] **Step 1: Write failing test**

`spotify-iceberg/container/tests/test_main.py`:

```python
from fastapi.testclient import TestClient

from spotify_iceberg.main import app


def test_health_returns_ok() -> None:
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 2: Run test**

```bash
cd spotify-iceberg/container
uv run pytest tests/test_main.py -v
```

Expected: PASS (the health route already exists from A2).

- [ ] **Step 3: Commit**

```bash
cd ../..
git add spotify-iceberg/container/tests/test_main.py
git commit -m "test(spotify-iceberg): health endpoint test"
```

---

### Task A4: Worker outbound handler scaffold (no test yet)

**Files:**
- Modify: `spotify-iceberg/worker/src/index.ts`

- [ ] **Step 1: Replace `src/index.ts` with outbound wiring**

```typescript
import { Container } from "@cloudflare/containers";

export class SpotifyContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "5m";
}

SpotifyContainer.outboundByHost = {
  "kv.internal": async (request, env: Env): Promise<Response> => {
    const url = new URL(request.url);
    const key = url.pathname.slice(1);
    if (!key) return new Response("missing key", { status: 400 });

    if (request.method === "GET") {
      const value = await env.SPOTIFY_STATE_KV.get(key);
      if (value === null) return new Response("", { status: 404 });
      return new Response(value, { status: 200 });
    }

    if (request.method === "PUT") {
      const body = await request.text();
      await env.SPOTIFY_STATE_KV.put(key, body);
      return new Response(null, { status: 204 });
    }

    return new Response("method not allowed", { status: 405 });
  },
};

export default {
  async scheduled(_event, env, _ctx) {
    const id = env.SPOTIFY_CONTAINER.idFromName("spotify");
    const stub = env.SPOTIFY_CONTAINER.get(id);
    const res = await stub.fetch("http://container/run", { method: "POST" });
    console.log(`container /run status=${res.status}`);
  },
  async fetch(request, env) {
    if (new URL(request.url).pathname === "/trigger") {
      const id = env.SPOTIFY_CONTAINER.idFromName("spotify");
      const stub = env.SPOTIFY_CONTAINER.get(id);
      return stub.fetch("http://container/run", { method: "POST" });
    }
    return new Response("spotify-iceberg worker", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 2: Typecheck**

```bash
cd spotify-iceberg/worker
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ../..
git add spotify-iceberg/worker/src/index.ts
git commit -m "feat(spotify-iceberg): add outbound KV handler and scheduled trigger"
```

---

### Task A5: Wrangler config with Container + DO + cron

**Files:**
- Create: `spotify-iceberg/worker/wrangler.jsonc`

- [ ] **Step 1: Create `spotify-iceberg/worker/wrangler.jsonc`**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "spotify-iceberg",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-20",
  "compatibility_flags": ["nodejs_compat"],
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  },
  "triggers": {
    "crons": ["0 * * * *"]
  },
  "kv_namespaces": [
    {
      "binding": "SPOTIFY_STATE_KV",
      "id": "REPLACE_WITH_WRANGLER_KV_CREATE_OUTPUT"
    }
  ],
  "containers": [
    {
      "class_name": "SpotifyContainer",
      "image": "../container/Dockerfile",
      "max_instances": 1,
      "instance_type": "basic"
    }
  ],
  "durable_objects": {
    "bindings": [
      { "class_name": "SpotifyContainer", "name": "SPOTIFY_CONTAINER" }
    ]
  },
  "migrations": [
    { "new_sqlite_classes": ["SpotifyContainer"], "tag": "v1" }
  ]
  // secrets (use `wrangler secret put ...`):
  //   SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
  //   R2_CATALOG_URI, R2_CATALOG_TOKEN, R2_CATALOG_WAREHOUSE
  //   R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
}
```

- [ ] **Step 2: Typecheck passes**

```bash
cd spotify-iceberg/worker && pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
cd ../..
git add spotify-iceberg/worker/wrangler.jsonc
git commit -m "feat(spotify-iceberg): wrangler config with container + DO + cron"
```

---

### Task A6: Worker outbound handler unit test

**Files:**
- Create: `spotify-iceberg/worker/src/__tests__/outbound.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { SpotifyContainer } from "../index";

// Access outbound handler directly — it's a static property, not an HTTP route
const handler = SpotifyContainer.outboundByHost?.["kv.internal"];

describe("outbound kv.internal handler", () => {
  beforeEach(async () => {
    await env.SPOTIFY_STATE_KV.delete("refresh_token");
    await env.SPOTIFY_STATE_KV.delete("cursor");
  });

  it("returns 404 when key missing", async () => {
    if (!handler) throw new Error("handler not registered");
    const res = await handler(
      new Request("http://kv.internal/refresh_token"),
      env as Env,
      {} as ExecutionContext
    );
    expect(res.status).toBe(404);
  });

  it("returns stored value on GET", async () => {
    if (!handler) throw new Error("handler not registered");
    await env.SPOTIFY_STATE_KV.put("refresh_token", "AQB-xyz");
    const res = await handler(
      new Request("http://kv.internal/refresh_token"),
      env as Env,
      {} as ExecutionContext
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("AQB-xyz");
  });

  it("writes and reads back with PUT", async () => {
    if (!handler) throw new Error("handler not registered");
    const putRes = await handler(
      new Request("http://kv.internal/cursor", {
        method: "PUT",
        body: "1713500400000",
      }),
      env as Env,
      {} as ExecutionContext
    );
    expect(putRes.status).toBe(204);
    expect(await env.SPOTIFY_STATE_KV.get("cursor")).toBe("1713500400000");
  });

  it("rejects unknown method with 405", async () => {
    if (!handler) throw new Error("handler not registered");
    const res = await handler(
      new Request("http://kv.internal/refresh_token", { method: "DELETE" }),
      env as Env,
      {} as ExecutionContext
    );
    expect(res.status).toBe(405);
  });

  it("rejects empty key with 400", async () => {
    if (!handler) throw new Error("handler not registered");
    const res = await handler(
      new Request("http://kv.internal/"),
      env as Env,
      {} as ExecutionContext
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run**

```bash
cd spotify-iceberg/worker && pnpm test:run
```

Expected: all 5 tests PASS.

- [ ] **Step 3: Commit**

```bash
cd ../..
git add spotify-iceberg/worker/src/__tests__/outbound.test.ts
git commit -m "test(spotify-iceberg): outbound kv.internal handler tests"
```

---

## Phase B — Spotify refresh token helper (one-shot)

### Task B1: Local `get_refresh_token.py`

This script runs locally once to obtain a `refresh_token` via the Authorization Code flow. No unit test; verification is the interactive flow.

**Files:**
- Create: `scripts/spotify/get_refresh_token.py`

- [ ] **Step 1: Create the script**

```python
"""
One-shot helper to obtain a Spotify refresh_token for user-read-recently-played.

Usage:
  uv run --with spotipy python scripts/spotify/get_refresh_token.py

Prerequisite: in https://developer.spotify.com/dashboard register an app with
redirect URI http://localhost:8888/callback.

After printing the refresh_token, load it into KV:
  wrangler kv key put --binding=SPOTIFY_STATE_KV refresh_token "<value>"
"""
from __future__ import annotations

import sys

import spotipy
from spotipy.oauth2 import SpotifyOAuth


def main() -> None:
    client_id = input("Spotify Client ID: ").strip()
    client_secret = input("Spotify Client Secret: ").strip()
    if not client_id or not client_secret:
        sys.exit("client id/secret required")

    auth = SpotifyOAuth(
        client_id=client_id,
        client_secret=client_secret,
        redirect_uri="http://localhost:8888/callback",
        scope="user-read-recently-played",
        open_browser=True,
        cache_path=None,
    )
    token_info = auth.get_access_token(as_dict=True)
    refresh_token = token_info.get("refresh_token")
    if not refresh_token:
        sys.exit("no refresh_token returned; check scope grant")

    print("\n=== refresh_token ===")
    print(refresh_token)
    print("\nLoad into KV:")
    print(
        f'  wrangler kv key put --binding=SPOTIFY_STATE_KV refresh_token "{refresh_token}"'
    )


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Commit**

```bash
git add scripts/spotify/get_refresh_token.py
git commit -m "feat(spotify-iceberg): add local refresh_token helper script"
```

---

## Phase C — PyIceberg schema

### Task C1: Schema module with types, partition spec, sort order

**Files:**
- Create: `spotify-iceberg/container/src/spotify_iceberg/schema.py`

- [ ] **Step 1: Create schema module**

```python
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

# --- artist ---
ARTIST_STRUCT = StructType(
    NestedField(101, "id", StringType(), required=True),
    NestedField(102, "name", StringType(), required=True),
    NestedField(103, "uri", StringType(), required=False),
)

# --- album ---
ALBUM_STRUCT = StructType(
    NestedField(201, "id", StringType(), required=True),
    NestedField(202, "name", StringType(), required=True),
    NestedField(203, "uri", StringType(), required=False),
    NestedField(204, "album_type", StringType(), required=False),
    NestedField(205, "release_date", StringType(), required=False),
    NestedField(206, "total_tracks", IntegerType(), required=False),
)

# --- track ---
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

# --- context ---
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
```

- [ ] **Step 2: Commit**

```bash
git add spotify-iceberg/container/src/spotify_iceberg/schema.py
git commit -m "feat(spotify-iceberg): define Iceberg schema for recently_played"
```

---

### Task C2: Schema test fixture + round-trip test

**Files:**
- Create: `spotify-iceberg/container/tests/fixtures/recently_played_sample.json`
- Create: `spotify-iceberg/container/tests/test_schema.py`

- [ ] **Step 1: Create sample fixture**

`tests/fixtures/recently_played_sample.json` (one representative item):

```json
{
  "items": [
    {
      "track": {
        "id": "11dFghVXANMlKmJXsNCbNl",
        "name": "Cut To The Feeling",
        "uri": "spotify:track:11dFghVXANMlKmJXsNCbNl",
        "duration_ms": 207959,
        "explicit": false,
        "popularity": 72,
        "external_ids": {"isrc": "USUM71703861"},
        "album": {
          "id": "0tf4LjPlD2S3ghJLRT2lrc",
          "name": "Cut To The Feeling",
          "uri": "spotify:album:0tf4LjPlD2S3ghJLRT2lrc",
          "album_type": "single",
          "release_date": "2017-05-26",
          "total_tracks": 1
        },
        "artists": [
          {
            "id": "6sFIWsNpZYqfjUpaCgueju",
            "name": "Carly Rae Jepsen",
            "uri": "spotify:artist:6sFIWsNpZYqfjUpaCgueju"
          }
        ]
      },
      "played_at": "2026-04-20T10:00:00.000Z",
      "context": {
        "type": "playlist",
        "uri": "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"
      }
    }
  ]
}
```

- [ ] **Step 2: Write test `tests/test_schema.py`**

```python
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
    required_names = {
        f.name for f in RECENTLY_PLAYED_SCHEMA.fields if f.required
    }
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
```

- [ ] **Step 3: Run**

```bash
cd spotify-iceberg/container && uv run pytest tests/test_schema.py -v
```

Expected: 5 tests PASS.

- [ ] **Step 4: Commit**

```bash
cd ../..
git add spotify-iceberg/container/tests/fixtures spotify-iceberg/container/tests/test_schema.py
git commit -m "test(spotify-iceberg): schema structural tests"
```

---

## Phase D — Spotify API client

### Task D1: Config module for env vars

**Files:**
- Create: `spotify-iceberg/container/src/spotify_iceberg/config.py`
- Create: `spotify-iceberg/container/tests/test_config.py`

- [ ] **Step 1: Write failing test `tests/test_config.py`**

```python
from __future__ import annotations

import os

import pytest

from spotify_iceberg.config import Settings


def test_settings_reads_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SPOTIFY_CLIENT_ID", "cid")
    monkeypatch.setenv("SPOTIFY_CLIENT_SECRET", "csec")
    monkeypatch.setenv("R2_CATALOG_URI", "https://cat/uri")
    monkeypatch.setenv("R2_CATALOG_TOKEN", "tok")
    monkeypatch.setenv("R2_CATALOG_WAREHOUSE", "wh")
    monkeypatch.setenv("R2_ENDPOINT", "https://r2/ep")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "ak")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "sk")

    s = Settings()
    assert s.spotify_client_id == "cid"
    assert s.r2_catalog_uri == "https://cat/uri"
    assert s.kv_base_url == "http://kv.internal"
    assert s.first_run_lookback_ms == 60 * 60 * 1000
```

- [ ] **Step 2: Run — expect ImportError**

```bash
cd spotify-iceberg/container && uv run pytest tests/test_config.py -v
```

Expected: FAIL with `ModuleNotFoundError: spotify_iceberg.config`.

- [ ] **Step 3: Create `src/spotify_iceberg/config.py`**

```python
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-driven configuration. Reads from os.environ."""

    spotify_client_id: str
    spotify_client_secret: str
    r2_catalog_uri: str
    r2_catalog_token: str
    r2_catalog_warehouse: str
    r2_endpoint: str
    r2_access_key_id: str
    r2_secret_access_key: str

    kv_base_url: str = "http://kv.internal"
    first_run_lookback_ms: int = 60 * 60 * 1000  # 1 hour

    model_config = SettingsConfigDict(case_sensitive=False)
```

- [ ] **Step 4: Run — expect PASS**

```bash
uv run pytest tests/test_config.py -v
```

- [ ] **Step 5: Commit**

```bash
cd ../..
git add spotify-iceberg/container/src/spotify_iceberg/config.py spotify-iceberg/container/tests/test_config.py
git commit -m "feat(spotify-iceberg): typed settings via pydantic-settings"
```

---

### Task D2: Spotify `refresh_access_token` function

**Files:**
- Create: `spotify-iceberg/container/src/spotify_iceberg/spotify.py`
- Create: `spotify-iceberg/container/tests/test_spotify.py`

- [ ] **Step 1: Write failing test**

```python
from __future__ import annotations

import httpx
import pytest
import respx

from spotify_iceberg.spotify import (
    InvalidGrantError,
    SpotifyClient,
)


@pytest.fixture
def client() -> SpotifyClient:
    return SpotifyClient(client_id="cid", client_secret="csec")


@respx.mock
def test_refresh_returns_new_access_and_keeps_same_refresh(
    client: SpotifyClient,
) -> None:
    respx.post("https://accounts.spotify.com/api/token").mock(
        return_value=httpx.Response(
            200,
            json={
                "access_token": "new-access",
                "token_type": "Bearer",
                "expires_in": 3600,
            },
        )
    )
    result = client.refresh_access_token("rt-original")
    assert result.access_token == "new-access"
    assert result.refresh_token == "rt-original"


@respx.mock
def test_refresh_picks_up_rotated_refresh_token(
    client: SpotifyClient,
) -> None:
    respx.post("https://accounts.spotify.com/api/token").mock(
        return_value=httpx.Response(
            200,
            json={
                "access_token": "new-access",
                "refresh_token": "rt-new",
                "token_type": "Bearer",
                "expires_in": 3600,
            },
        )
    )
    result = client.refresh_access_token("rt-old")
    assert result.refresh_token == "rt-new"


@respx.mock
def test_refresh_raises_invalid_grant_on_expired_token(
    client: SpotifyClient,
) -> None:
    respx.post("https://accounts.spotify.com/api/token").mock(
        return_value=httpx.Response(
            400,
            json={"error": "invalid_grant", "error_description": "Invalid refresh token"},
        )
    )
    with pytest.raises(InvalidGrantError):
        client.refresh_access_token("rt-dead")
```

- [ ] **Step 2: Run — expect ImportError**

```bash
cd spotify-iceberg/container && uv run pytest tests/test_spotify.py -v
```

Expected: FAIL (module not found).

- [ ] **Step 3: Create `src/spotify_iceberg/spotify.py`**

```python
from __future__ import annotations

import base64
from dataclasses import dataclass

import httpx

TOKEN_URL = "https://accounts.spotify.com/api/token"
API_BASE = "https://api.spotify.com/v1"


class SpotifyError(Exception):
    """Base exception for Spotify API failures."""


class InvalidGrantError(SpotifyError):
    """The refresh_token is no longer valid; human re-authorization needed."""


@dataclass(frozen=True)
class TokenResult:
    access_token: str
    refresh_token: str


class SpotifyClient:
    """Thin HTTP client for Spotify. Stateless."""

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        http_client: httpx.Client | None = None,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._http = http_client or httpx.Client(timeout=30.0)

    def _basic_auth(self) -> str:
        raw = f"{self._client_id}:{self._client_secret}".encode()
        return "Basic " + base64.b64encode(raw).decode()

    def refresh_access_token(self, refresh_token: str) -> TokenResult:
        resp = self._http.post(
            TOKEN_URL,
            headers={
                "Authorization": self._basic_auth(),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={"grant_type": "refresh_token", "refresh_token": refresh_token},
        )
        if resp.status_code == 400:
            body = resp.json()
            if body.get("error") == "invalid_grant":
                raise InvalidGrantError(body.get("error_description", "invalid_grant"))
        if resp.status_code >= 400:
            raise SpotifyError(f"token endpoint {resp.status_code}: {resp.text}")

        body = resp.json()
        return TokenResult(
            access_token=body["access_token"],
            refresh_token=body.get("refresh_token", refresh_token),
        )
```

- [ ] **Step 4: Run — expect PASS**

```bash
uv run pytest tests/test_spotify.py -v
```

- [ ] **Step 5: Commit**

```bash
cd ../..
git add spotify-iceberg/container/src/spotify_iceberg/spotify.py spotify-iceberg/container/tests/test_spotify.py
git commit -m "feat(spotify-iceberg): refresh_access_token with invalid_grant handling"
```

---

### Task D3: `recently_played` fetch with `after` cursor

**Files:**
- Modify: `spotify-iceberg/container/src/spotify_iceberg/spotify.py`
- Modify: `spotify-iceberg/container/tests/test_spotify.py`

- [ ] **Step 1: Append to `tests/test_spotify.py`**

```python
@respx.mock
def test_recently_played_returns_items(client: SpotifyClient) -> None:
    respx.get("https://api.spotify.com/v1/me/player/recently-played").mock(
        return_value=httpx.Response(
            200,
            json={
                "items": [
                    {
                        "track": {"id": "t1", "name": "song-a", "artists": []},
                        "played_at": "2026-04-20T10:00:00.000Z",
                    }
                ],
                "next": None,
            },
        )
    )
    items = client.recently_played("access-xyz", after_ms=1713500000000, limit=50)
    assert len(items) == 1
    assert items[0]["track"]["id"] == "t1"


@respx.mock
def test_recently_played_returns_empty_on_no_new_plays(
    client: SpotifyClient,
) -> None:
    respx.get("https://api.spotify.com/v1/me/player/recently-played").mock(
        return_value=httpx.Response(200, json={"items": [], "next": None})
    )
    assert client.recently_played("tok", after_ms=1713500000000) == []


@respx.mock
def test_recently_played_sends_after_param(client: SpotifyClient) -> None:
    route = respx.get(
        "https://api.spotify.com/v1/me/player/recently-played"
    ).mock(return_value=httpx.Response(200, json={"items": [], "next": None}))
    client.recently_played("tok", after_ms=12345)
    assert route.call_count == 1
    call = route.calls[0]
    assert "after=12345" in str(call.request.url)
    assert "limit=50" in str(call.request.url)
```

- [ ] **Step 2: Run — expect FAIL (attribute missing)**

```bash
cd spotify-iceberg/container && uv run pytest tests/test_spotify.py -v
```

Expected: FAIL with `AttributeError: 'SpotifyClient' object has no attribute 'recently_played'`.

- [ ] **Step 3: Add method to `spotify.py`** (inside the `SpotifyClient` class)

```python
    def recently_played(
        self,
        access_token: str,
        after_ms: int,
        limit: int = 50,
    ) -> list[dict]:
        resp = self._http.get(
            f"{API_BASE}/me/player/recently-played",
            params={"after": after_ms, "limit": limit},
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if resp.status_code == 401:
            raise SpotifyError(
                "spotify returned 401; access_token likely expired mid-flight"
            )
        if resp.status_code == 403:
            raise SpotifyError(f"spotify forbidden: {resp.text}")
        if resp.status_code >= 400:
            raise SpotifyError(f"recently-played {resp.status_code}: {resp.text}")

        items = resp.json().get("items", [])
        return items
```

- [ ] **Step 4: Run — expect PASS**

```bash
uv run pytest tests/test_spotify.py -v
```

- [ ] **Step 5: Commit**

```bash
cd ../..
git add spotify-iceberg/container/src/spotify_iceberg/spotify.py spotify-iceberg/container/tests/test_spotify.py
git commit -m "feat(spotify-iceberg): recently_played fetch with after cursor"
```

---

### Task D4: Retry on 429/5xx with exponential backoff

**Files:**
- Modify: `spotify-iceberg/container/src/spotify_iceberg/spotify.py`
- Modify: `spotify-iceberg/container/tests/test_spotify.py`

- [ ] **Step 1: Append tests**

```python
@respx.mock
def test_recently_played_retries_on_5xx(client: SpotifyClient) -> None:
    route = respx.get(
        "https://api.spotify.com/v1/me/player/recently-played"
    ).mock(
        side_effect=[
            httpx.Response(503, json={}),
            httpx.Response(200, json={"items": [], "next": None}),
        ]
    )
    assert client.recently_played("tok", after_ms=1) == []
    assert route.call_count == 2


@respx.mock
def test_recently_played_retries_on_429_with_retry_after(
    client: SpotifyClient,
) -> None:
    route = respx.get(
        "https://api.spotify.com/v1/me/player/recently-played"
    ).mock(
        side_effect=[
            httpx.Response(429, headers={"Retry-After": "0"}),
            httpx.Response(200, json={"items": [], "next": None}),
        ]
    )
    assert client.recently_played("tok", after_ms=1) == []
    assert route.call_count == 2


@respx.mock
def test_recently_played_gives_up_after_max_retries(
    client: SpotifyClient,
) -> None:
    respx.get(
        "https://api.spotify.com/v1/me/player/recently-played"
    ).mock(return_value=httpx.Response(503, json={}))
    with pytest.raises(SpotifyError):
        client.recently_played("tok", after_ms=1)


# Add to existing imports at top of file:
# from spotify_iceberg.spotify import SpotifyError
```

Add the `SpotifyError` import:

```python
from spotify_iceberg.spotify import (
    InvalidGrantError,
    SpotifyClient,
    SpotifyError,
)
```

- [ ] **Step 2: Run — expect FAIL (only 1 call, no retry)**

```bash
cd spotify-iceberg/container && uv run pytest tests/test_spotify.py -v
```

- [ ] **Step 3: Refactor `spotify.py` with a retry helper**

Replace the `recently_played` implementation with:

```python
import time

MAX_RETRIES = 3
BACKOFF_BASE_SEC = 0.5


def _should_retry(status_code: int) -> bool:
    return status_code == 429 or 500 <= status_code < 600


def _retry_after_sec(response: httpx.Response) -> float:
    header = response.headers.get("Retry-After")
    if header is not None:
        try:
            return min(float(header), 30.0)
        except ValueError:
            pass
    return 0.0


class SpotifyClient:
    # ... existing __init__ / _basic_auth / refresh_access_token ...

    def recently_played(
        self,
        access_token: str,
        after_ms: int,
        limit: int = 50,
    ) -> list[dict]:
        url = f"{API_BASE}/me/player/recently-played"
        params = {"after": after_ms, "limit": limit}
        headers = {"Authorization": f"Bearer {access_token}"}

        for attempt in range(MAX_RETRIES + 1):
            resp = self._http.get(url, params=params, headers=headers)
            if not _should_retry(resp.status_code):
                break
            if attempt == MAX_RETRIES:
                raise SpotifyError(
                    f"recently-played failed after {MAX_RETRIES + 1} attempts: "
                    f"status={resp.status_code}"
                )
            sleep_sec = _retry_after_sec(resp) or BACKOFF_BASE_SEC * (2**attempt)
            time.sleep(sleep_sec)

        if resp.status_code == 401:
            raise SpotifyError(
                "spotify returned 401; access_token likely expired mid-flight"
            )
        if resp.status_code == 403:
            raise SpotifyError(f"spotify forbidden: {resp.text}")
        if resp.status_code >= 400:
            raise SpotifyError(
                f"recently-played {resp.status_code}: {resp.text}"
            )
        return resp.json().get("items", [])
```

- [ ] **Step 4: Run — expect PASS**

```bash
uv run pytest tests/test_spotify.py -v
```

- [ ] **Step 5: Commit**

```bash
cd ../..
git add spotify-iceberg/container/src/spotify_iceberg/spotify.py spotify-iceberg/container/tests/test_spotify.py
git commit -m "feat(spotify-iceberg): retry recently_played on 429/5xx with backoff"
```

---

## Phase E — KV state via outbound

### Task E1: State module `get` and `put`

**Files:**
- Create: `spotify-iceberg/container/src/spotify_iceberg/state.py`
- Create: `spotify-iceberg/container/tests/test_state.py`

- [ ] **Step 1: Write failing test**

```python
from __future__ import annotations

import httpx
import pytest
import respx

from spotify_iceberg.state import StateStore


@pytest.fixture
def store() -> StateStore:
    return StateStore(base_url="http://kv.internal")


@respx.mock
def test_get_returns_value_on_200(store: StateStore) -> None:
    respx.get("http://kv.internal/refresh_token").mock(
        return_value=httpx.Response(200, text="AQB-xyz")
    )
    assert store.get("refresh_token") == "AQB-xyz"


@respx.mock
def test_get_returns_none_on_404(store: StateStore) -> None:
    respx.get("http://kv.internal/cursor").mock(
        return_value=httpx.Response(404)
    )
    assert store.get("cursor") is None


@respx.mock
def test_put_sends_plain_text_body(store: StateStore) -> None:
    route = respx.put("http://kv.internal/cursor").mock(
        return_value=httpx.Response(204)
    )
    store.put("cursor", "1713500400000")
    assert route.call_count == 1
    assert route.calls[0].request.content == b"1713500400000"


@respx.mock
def test_get_raises_on_unexpected_status(store: StateStore) -> None:
    respx.get("http://kv.internal/foo").mock(
        return_value=httpx.Response(500)
    )
    with pytest.raises(RuntimeError):
        store.get("foo")
```

- [ ] **Step 2: Run — expect ImportError**

- [ ] **Step 3: Create `state.py`**

```python
from __future__ import annotations

import httpx


class StateStore:
    """KV access via the worker outbound handler at kv.internal."""

    def __init__(
        self,
        base_url: str,
        http_client: httpx.Client | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._http = http_client or httpx.Client(timeout=10.0)

    def get(self, key: str) -> str | None:
        resp = self._http.get(f"{self._base_url}/{key}")
        if resp.status_code == 404:
            return None
        if resp.status_code != 200:
            raise RuntimeError(f"state.get({key}) status={resp.status_code}")
        return resp.text

    def put(self, key: str, value: str) -> None:
        resp = self._http.put(f"{self._base_url}/{key}", content=value)
        if resp.status_code not in (200, 204):
            raise RuntimeError(f"state.put({key}) status={resp.status_code}")
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd spotify-iceberg/container && uv run pytest tests/test_state.py -v
```

- [ ] **Step 5: Commit**

```bash
cd ../..
git add spotify-iceberg/container/src/spotify_iceberg/state.py spotify-iceberg/container/tests/test_state.py
git commit -m "feat(spotify-iceberg): KV state store via outbound"
```

---

## Phase F — Iceberg writer

### Task F1: `build_arrow_table` from Spotify items

**Files:**
- Create: `spotify-iceberg/container/src/spotify_iceberg/iceberg_writer.py`
- Create: `spotify-iceberg/container/tests/test_iceberg_writer.py`

- [ ] **Step 1: Write failing test**

```python
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pyarrow as pa
import pytest

from spotify_iceberg.iceberg_writer import build_arrow_table

FIXTURE = Path(__file__).parent / "fixtures" / "recently_played_sample.json"


@pytest.fixture
def sample_items() -> list[dict]:
    return json.loads(FIXTURE.read_text())["items"]


def test_build_arrow_table_has_expected_columns(sample_items) -> None:
    table = build_arrow_table(
        sample_items,
        ingested_at=datetime(2026, 4, 20, 10, 5, 0, tzinfo=timezone.utc),
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
        ingested_at=datetime(2026, 4, 20, 10, 5, 0, tzinfo=timezone.utc),
    )
    played_at_ms = table.column("played_at_ms")[0].as_py()
    expected = int(
        datetime(2026, 4, 20, 10, 0, 0, tzinfo=timezone.utc).timestamp() * 1000
    )
    assert played_at_ms == expected


def test_build_arrow_table_keeps_raw_json(sample_items) -> None:
    table = build_arrow_table(
        sample_items,
        ingested_at=datetime(2026, 4, 20, 10, 5, 0, tzinfo=timezone.utc),
    )
    raw = table.column("_raw_json")[0].as_py()
    parsed = json.loads(raw)
    assert parsed["track"]["id"] == sample_items[0]["track"]["id"]


def test_build_arrow_table_extracts_isrc(sample_items) -> None:
    table = build_arrow_table(
        sample_items,
        ingested_at=datetime(2026, 4, 20, 10, 5, 0, tzinfo=timezone.utc),
    )
    track = table.column("track")[0].as_py()
    assert track["isrc"] == "USUM71703861"


def test_build_arrow_table_handles_null_context() -> None:
    items = [
        {
            "track": {
                "id": "t1",
                "name": "n1",
                "artists": [{"id": "a1", "name": "an1"}],
            },
            "played_at": "2026-04-20T11:00:00.000Z",
            "context": None,
        }
    ]
    table = build_arrow_table(
        items,
        ingested_at=datetime(2026, 4, 20, 11, 1, 0, tzinfo=timezone.utc),
    )
    assert table.column("context")[0].as_py() is None
```

- [ ] **Step 2: Run — expect ImportError**

- [ ] **Step 3: Create `iceberg_writer.py` with `build_arrow_table`**

```python
from __future__ import annotations

import json
from datetime import datetime

import pyarrow as pa


def _parse_iso_utc(ts: str) -> datetime:
    # Spotify returns 2026-04-20T10:00:00.000Z; replace Z for fromisoformat
    if ts.endswith("Z"):
        ts = ts[:-1] + "+00:00"
    return datetime.fromisoformat(ts)


def _build_artist(artist: dict) -> dict:
    return {
        "id": artist["id"],
        "name": artist["name"],
        "uri": artist.get("uri"),
    }


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


_ARTIST_TYPE = pa.struct(
    [
        ("id", pa.string()),
        ("name", pa.string()),
        ("uri", pa.string()),
    ]
)

_ALBUM_TYPE = pa.struct(
    [
        ("id", pa.string()),
        ("name", pa.string()),
        ("uri", pa.string()),
        ("album_type", pa.string()),
        ("release_date", pa.string()),
        ("total_tracks", pa.int32()),
    ]
)

_TRACK_TYPE = pa.struct(
    [
        ("id", pa.string()),
        ("name", pa.string()),
        ("uri", pa.string()),
        ("duration_ms", pa.int32()),
        ("explicit", pa.bool_()),
        ("popularity", pa.int32()),
        ("isrc", pa.string()),
        ("album", _ALBUM_TYPE),
        ("artists", pa.list_(_ARTIST_TYPE)),
    ]
)

_CONTEXT_TYPE = pa.struct(
    [
        ("type", pa.string()),
        ("uri", pa.string()),
    ]
)

_ARROW_SCHEMA = pa.schema(
    [
        ("played_at", pa.timestamp("us", tz="UTC")),
        ("played_at_ms", pa.int64()),
        ("track", _TRACK_TYPE),
        ("context", _CONTEXT_TYPE),
        ("_raw_json", pa.string()),
        ("_ingested_at", pa.timestamp("us", tz="UTC")),
    ]
)


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
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd spotify-iceberg/container && uv run pytest tests/test_iceberg_writer.py -v
```

- [ ] **Step 5: Commit**

```bash
cd ../..
git add spotify-iceberg/container/src/spotify_iceberg/iceberg_writer.py spotify-iceberg/container/tests/test_iceberg_writer.py
git commit -m "feat(spotify-iceberg): build_arrow_table converts Spotify items to PyArrow"
```

---

### Task F2: `ensure_table` creates namespace and table if missing

**Files:**
- Modify: `spotify-iceberg/container/src/spotify_iceberg/iceberg_writer.py`
- Modify: `spotify-iceberg/container/tests/test_iceberg_writer.py`
- Modify: `spotify-iceberg/container/tests/conftest.py`

- [ ] **Step 1: Add a local-catalog fixture to `conftest.py`** (append at the end)

```python
import pytest
from pyiceberg.catalog import Catalog
from pyiceberg.catalog.sql import SqlCatalog


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
```

- [ ] **Step 2: Append test to `test_iceberg_writer.py`**

```python
from pyiceberg.catalog import Catalog

from spotify_iceberg.iceberg_writer import ensure_table


def test_ensure_table_creates_namespace_and_table(local_catalog: Catalog) -> None:
    table = ensure_table(local_catalog, ("spotify", "recently_played"))
    assert table.identifier[-2:] == ("spotify", "recently_played")
    # Idempotent — second call returns existing table
    again = ensure_table(local_catalog, ("spotify", "recently_played"))
    assert again.metadata.table_uuid == table.metadata.table_uuid


def test_ensure_table_schema_matches(local_catalog: Catalog) -> None:
    table = ensure_table(local_catalog, ("spotify", "recently_played"))
    names = [f.name for f in table.schema().fields]
    assert "played_at" in names
    assert "_raw_json" in names
```

- [ ] **Step 3: Run — expect FAIL (ensure_table missing)**

- [ ] **Step 4: Add to `iceberg_writer.py`**

```python
from pyiceberg.catalog import Catalog
from pyiceberg.table import Table

from .schema import PARTITION_SPEC, RECENTLY_PLAYED_SCHEMA, SORT_ORDER, TABLE_PROPERTIES


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
```

- [ ] **Step 5: Run — expect PASS**

```bash
uv run pytest tests/test_iceberg_writer.py -v
```

- [ ] **Step 6: Commit**

```bash
cd ../..
git add spotify-iceberg/container
git commit -m "feat(spotify-iceberg): ensure_table creates namespace + table idempotently"
```

---

### Task F3: `append_items` end-to-end writer

**Files:**
- Modify: `spotify-iceberg/container/src/spotify_iceberg/iceberg_writer.py`
- Modify: `spotify-iceberg/container/tests/test_iceberg_writer.py`

- [ ] **Step 1: Append test**

```python
def test_append_items_roundtrip(local_catalog: Catalog, sample_items) -> None:
    from datetime import datetime, timezone

    from spotify_iceberg.iceberg_writer import append_items

    result = append_items(
        local_catalog,
        ("spotify", "recently_played"),
        sample_items,
        ingested_at=datetime(2026, 4, 20, 10, 5, 0, tzinfo=timezone.utc),
    )
    assert result.rows_written == len(sample_items)

    table = local_catalog.load_table(("spotify", "recently_played"))
    scan = table.scan().to_arrow()
    assert scan.num_rows == len(sample_items)
    first = scan.to_pylist()[0]
    assert first["track"]["id"] == sample_items[0]["track"]["id"]


def test_append_items_empty_is_noop(local_catalog: Catalog) -> None:
    from datetime import datetime, timezone

    from spotify_iceberg.iceberg_writer import append_items

    result = append_items(
        local_catalog,
        ("spotify", "recently_played"),
        [],
        ingested_at=datetime(2026, 4, 20, 10, 5, 0, tzinfo=timezone.utc),
    )
    assert result.rows_written == 0
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Add to `iceberg_writer.py`**

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class AppendResult:
    rows_written: int
    snapshot_id: int | None


def append_items(
    catalog: Catalog,
    identifier: tuple[str, str],
    items: list[dict],
    ingested_at: datetime,
) -> AppendResult:
    if not items:
        return AppendResult(rows_written=0, snapshot_id=None)
    table = ensure_table(catalog, identifier)
    arrow_table = build_arrow_table(items, ingested_at=ingested_at)
    table.append(arrow_table)
    current = table.current_snapshot()
    return AppendResult(
        rows_written=len(items),
        snapshot_id=current.snapshot_id if current else None,
    )
```

- [ ] **Step 4: Run — expect PASS**

```bash
uv run pytest tests/test_iceberg_writer.py -v
```

- [ ] **Step 5: Commit**

```bash
cd ../..
git add spotify-iceberg/container
git commit -m "feat(spotify-iceberg): append_items writes arrow table to Iceberg"
```

---

## Phase G — Pipeline orchestration

### Task G1: Pipeline happy path

**Files:**
- Create: `spotify-iceberg/container/src/spotify_iceberg/pipeline.py`
- Create: `spotify-iceberg/container/tests/test_pipeline.py`

- [ ] **Step 1: Write failing test**

```python
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
    # cursor advanced to max played_at_ms
    state.put.assert_any_call(
        "cursor",
        str(int(datetime(2026, 4, 20, 10, 0, 0, tzinfo=timezone.utc).timestamp() * 1000)),
    )
    # refresh_token not rotated -> no put
    refresh_puts = [
        c for c in state.put.call_args_list if c.args[0] == "refresh_token"
    ]
    assert refresh_puts == []
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Create `pipeline.py`**

```python
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
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd spotify-iceberg/container && uv run pytest tests/test_pipeline.py -v
```

- [ ] **Step 5: Commit**

```bash
cd ../..
git add spotify-iceberg/container
git commit -m "feat(spotify-iceberg): pipeline orchestration happy path"
```

---

### Task G2: Pipeline first-run bootstrap

**Files:**
- Modify: `spotify-iceberg/container/tests/test_pipeline.py`

- [ ] **Step 1: Append test**

```python
def test_run_recently_played_first_run_uses_lookback(local_catalog) -> None:
    state = MagicMock()
    # cursor absent on first run
    state.get.side_effect = lambda k: {
        "refresh_token": "rt-initial",
    }.get(k)

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
    spotify.recently_played.assert_called_once_with(
        "at-123", after_ms=expected_after_ms
    )


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
        state=state,
        spotify=spotify,
        catalog=local_catalog,
        now=_fixed_now,
    )
    assert result.rows_written == 0
    cursor_puts = [c for c in state.put.call_args_list if c.args[0] == "cursor"]
    assert cursor_puts == []


def test_run_recently_played_rotates_refresh_token(
    sample_items, local_catalog
) -> None:
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
        state=state,
        spotify=spotify,
        catalog=local_catalog,
        now=_fixed_now,
    )
    state.put.assert_any_call("refresh_token", "rt-new")


def test_run_recently_played_raises_without_refresh_token(local_catalog) -> None:
    state = MagicMock()
    state.get.return_value = None
    spotify = MagicMock()

    with pytest.raises(RuntimeError, match="refresh_token not found"):
        run_recently_played(
            state=state,
            spotify=spotify,
            catalog=local_catalog,
            now=_fixed_now,
        )
```

- [ ] **Step 2: Run — expect PASS (pipeline already handles these paths)**

```bash
cd spotify-iceberg/container && uv run pytest tests/test_pipeline.py -v
```

- [ ] **Step 3: Commit**

```bash
cd ../..
git add spotify-iceberg/container/tests/test_pipeline.py
git commit -m "test(spotify-iceberg): pipeline bootstrap, zero-items, rotation, missing-token"
```

---

## Phase H — FastAPI wiring

### Task H1: `/run` endpoint using lazy-initialized singletons

**Files:**
- Modify: `spotify-iceberg/container/src/spotify_iceberg/main.py`
- Create: `spotify-iceberg/container/tests/test_main_run.py`

- [ ] **Step 1: Write failing test**

```python
from __future__ import annotations

from unittest.mock import patch

from fastapi.testclient import TestClient

from spotify_iceberg.main import app
from spotify_iceberg.pipeline import PipelineResult


def test_run_returns_pipeline_result() -> None:
    with patch("spotify_iceberg.main.run_recently_played") as mock_run:
        mock_run.return_value = PipelineResult(
            rows_written=3,
            new_cursor_ms=1713500400000,
            snapshot_id=4242,
        )
        client = TestClient(app)
        resp = client.post("/run")

    assert resp.status_code == 200
    body = resp.json()
    assert body["rows_written"] == 3
    assert body["new_cursor_ms"] == 1713500400000
    assert body["snapshot_id"] == 4242


def test_run_surfaces_errors_as_500() -> None:
    with patch("spotify_iceberg.main.run_recently_played", side_effect=RuntimeError("boom")):
        client = TestClient(app)
        resp = client.post("/run")
    assert resp.status_code == 500
    assert "boom" in resp.json()["error"]
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Replace `main.py`**

```python
from __future__ import annotations

import logging
from dataclasses import asdict

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pyiceberg.catalog.rest import RestCatalog

from .config import Settings
from .pipeline import run_recently_played
from .spotify import SpotifyClient
from .state import StateStore

logger = logging.getLogger("spotify_iceberg")
logging.basicConfig(level=logging.INFO, format="%(message)s")

app = FastAPI(title="spotify-iceberg")


def _build_catalog(settings: Settings) -> RestCatalog:
    return RestCatalog(
        "r2",
        **{
            "uri": settings.r2_catalog_uri,
            "token": settings.r2_catalog_token,
            "warehouse": settings.r2_catalog_warehouse,
            "s3.endpoint": settings.r2_endpoint,
            "s3.access-key-id": settings.r2_access_key_id,
            "s3.secret-access-key": settings.r2_secret_access_key,
            "s3.region": "auto",
        },
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/run")
def run() -> JSONResponse:
    settings = Settings()
    state = StateStore(base_url=settings.kv_base_url)
    spotify = SpotifyClient(
        client_id=settings.spotify_client_id,
        client_secret=settings.spotify_client_secret,
    )
    catalog = _build_catalog(settings)

    try:
        result = run_recently_played(
            state=state,
            spotify=spotify,
            catalog=catalog,
            first_run_lookback_ms=settings.first_run_lookback_ms,
        )
    except Exception as exc:
        logger.exception("pipeline failed")
        return JSONResponse({"error": str(exc)}, status_code=500)

    logger.info("pipeline ok rows=%s cursor=%s", result.rows_written, result.new_cursor_ms)
    return JSONResponse(asdict(result))
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd spotify-iceberg/container && uv run pytest tests/test_main_run.py -v
```

- [ ] **Step 5: Commit**

```bash
cd ../..
git add spotify-iceberg/container
git commit -m "feat(spotify-iceberg): FastAPI /run endpoint wires pipeline"
```

---

## Phase I — Deployment prep

### Task I1: Container README with setup instructions

**Files:**
- Create: `spotify-iceberg/README.md`

- [ ] **Step 1: Write README**

```markdown
# spotify-iceberg

Cloudflare Worker + Container pipeline that appends Spotify recently-played
history to an Apache Iceberg table on R2 Data Catalog every hour.

Spec: [Linear TA-469](https://linear.app/ta93abe/issue/TA-469/spotify-r2-iceberg-データパイプライン設計)

## Setup (one-time)

### 1. Enable R2 Data Catalog

```bash
wrangler r2 bucket catalog enable lake
```

Note the printed **Catalog URI** and **Warehouse** — you'll need them in step 6.

### 2. Create Spotify Developer app

At <https://developer.spotify.com/dashboard>, create an app and register
`http://localhost:8888/callback` as a Redirect URI. Note the Client ID and
Client Secret.

### 3. Obtain refresh_token locally

```bash
uv run --with spotipy python scripts/spotify/get_refresh_token.py
```

Follow the browser flow; the script prints the refresh_token.

### 4. Create KV namespace

```bash
cd spotify-iceberg/worker
wrangler kv namespace create SPOTIFY_STATE_KV
```

Copy the printed `id` into `wrangler.jsonc` under `kv_namespaces[0].id`.

### 5. Store refresh_token in KV

```bash
wrangler kv key put --binding=SPOTIFY_STATE_KV refresh_token "<value-from-step-3>"
```

### 6. Register secrets (from spotify-iceberg/worker/)

```bash
wrangler secret put SPOTIFY_CLIENT_ID
wrangler secret put SPOTIFY_CLIENT_SECRET
wrangler secret put R2_CATALOG_URI
wrangler secret put R2_CATALOG_TOKEN
wrangler secret put R2_CATALOG_WAREHOUSE
wrangler secret put R2_ENDPOINT
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

### 7. Deploy

```bash
cd spotify-iceberg/worker && pnpm deploy
```

### 8. Verify

- Trigger manually: `curl -X POST https://spotify-iceberg.<account>.workers.dev/trigger`
- Tail logs: `wrangler tail`
- Query via DuckDB:

```sql
INSTALL iceberg; LOAD iceberg;
ATTACH '<R2_CATALOG_URI>' AS r2 (TYPE ICEBERG, ENDPOINT_TYPE S3_TABLES);
SELECT played_at, track.name, track.artists[1].name
FROM r2.spotify.recently_played
ORDER BY played_at DESC LIMIT 10;
```

## Development

- Worker: `cd worker && pnpm test:run && pnpm typecheck && pnpm check`
- Container: `cd container && uv run pytest && uv run ruff check .`

## Open TODOs

See [TA-469 Open Questions](https://linear.app/ta93abe/issue/TA-469).
```

- [ ] **Step 2: Commit**

```bash
git add spotify-iceberg/README.md
git commit -m "docs(spotify-iceberg): setup and verification instructions"
```

---

### Task I2: Wrangler local dev smoke (no test; manual)

- [ ] **Step 1: Run local dev**

```bash
cd spotify-iceberg/worker && pnpm dev
```

Expected:
- Wrangler starts, builds container image
- Visiting `http://localhost:8787/` returns `spotify-iceberg worker`
- Visiting `http://localhost:8787/trigger` attempts to reach container (may fail at KV read — that's fine for smoke)

Stop with `Ctrl+C`.

- [ ] **Step 2: Deploy to production**

```bash
pnpm deploy
```

Expected: Worker deploys without errors. Container image is built and uploaded.

- [ ] **Step 3: No commit needed**

---

### Task I3: E2E verification (manual, after setup steps 1–6 of README complete)

- [ ] **Step 1: Manually trigger**

```bash
curl -X POST https://spotify-iceberg.<acct>.workers.dev/trigger
```

Expected response: `{"rows_written": N, "new_cursor_ms": ..., "snapshot_id": ...}` (N may be 0 if no new plays).

- [ ] **Step 2: Verify KV cursor advanced**

```bash
wrangler kv key get --binding=SPOTIFY_STATE_KV cursor
```

Expected: an epoch-ms integer corresponding to the latest played_at.

- [ ] **Step 3: DuckDB query**

Use the query from README §8. Expected: at least N rows with matching track names.

- [ ] **Step 4: Wait for one cron firing (up to 1 hour) and re-check**

Expected: log entry `container /run status=200` in `wrangler tail`; row count grows if new plays happened.

---

## Phase J — CI integration

### Task J1: GitHub Actions for spotify-iceberg

**Files:**
- Create: `.github/workflows/spotify-iceberg.yml`

- [ ] **Step 1: Create workflow file**

```yaml
name: spotify-iceberg CI

on:
  pull_request:
    paths:
      - "spotify-iceberg/**"
      - ".github/workflows/spotify-iceberg.yml"
  push:
    branches: [main]
    paths:
      - "spotify-iceberg/**"
      - ".github/workflows/spotify-iceberg.yml"

jobs:
  worker:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: spotify-iceberg/worker
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
          cache-dependency-path: spotify-iceberg/worker/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
      - run: pnpm typecheck
      - run: pnpm test:run

  container:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: spotify-iceberg/container
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v4
        with:
          version: latest
      - run: uv sync --extra dev
      - run: uv run ruff check .
      - run: uv run pytest -v
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/spotify-iceberg.yml
git commit -m "ci(spotify-iceberg): add worker+container CI workflow"
```

---

## Phase K — Final polish

### Task K1: Link plan and spec from Linear + update status

- [ ] **Step 1: Post comment on TA-469 linking to the implemented branch/PR**

(Do this manually or with the Linear MCP after the PR is opened.)

- [ ] **Step 2: Move TA-469 to "In Progress" when Task A1 starts, "In Review" when PR opens, "Done" when merged**

No code; Linear status transitions only.

---

## Full test matrix

Run everything before declaring Phase 1 complete:

```bash
# Worker
cd spotify-iceberg/worker
pnpm check
pnpm typecheck
pnpm test:run

# Container
cd ../container
uv run ruff check .
uv run pytest -v
```

Expected: all green.

---

## Summary

- **6 phases A–K** (~24 tasks) producing a deployable hourly pipeline
- **All non-interactive tasks follow TDD**: failing test → implement → passing test → commit
- **No network in tests**: `respx` mocks Spotify API + KV outbound; `SqlCatalog` + local filesystem replaces R2
- **Phase 2 (separate plan)**: `top_tracks_daily`, `saved_tracks`, `audio_features` enrichment, Streaming History bulk backfill, Workflows migration — all listed as Open Questions in TA-469
