# spotify-iceberg

Cloudflare Worker + Container pipeline that appends Spotify recently-played
history to an Apache Iceberg table on R2 Data Catalog every hour.

Spec & plan: [Linear TA-469](https://linear.app/ta93abe/issue/TA-469)

## Setup (one-time)

### 1. Enable R2 Data Catalog

```bash
wrangler r2 bucket catalog enable data-lake
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

### 6. Register secrets (from `spotify-iceberg/worker/`)

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
