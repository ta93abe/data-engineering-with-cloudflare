# modeling

Snowflake-targeted dbt project implementing a Data Vault 2.0 layout
with the `datavault4dbt` package, plus a Kimball star schema on top.

Sources are the Iceberg tables living in the R2 Data Catalog catalog-
linked database `r2_lakehouse.seeds.*` (no CSV seeds in this project).

## Local development

```bash
cd modeling
uv sync

export SNOWFLAKE_ACCOUNT=<your-account>
export SNOWFLAKE_USER=TA93ABE
export SNOWFLAKE_PRIVATE_KEY_PATH=~/.ssh/snowflake_rsa_key.p8
# export SNOWFLAKE_PRIVATE_KEY_PASSPHRASE=...   # only if the key is encrypted

uv run dbt deps
uv run dbt debug
uv run dbt build
```

In the `dev` target everything materializes into the personal
database `USER$TA93ABE` regardless of the `+database` config in
`dbt_project.yml` (see `macros/generate_database_name.sql`).

## Running as a Cloudflare Container

This directory is also a Cloudflare Worker + Container project, with
the same architecture as `transform/core`:

| Piece | Role |
|---|---|
| `Dockerfile` | Python 3.12 + uv + dbt-core + dbt-snowflake + the project sources |
| `server.py` | Lightweight HTTP server exposing `/run`, `/test`, `/build`, `/docs` |
| `src/index.ts` | Worker that routes requests to the Durable Object-hosted container |
| `wrangler.jsonc` | Container + DO + R2 binding declarations |

### One-time setup

```bash
pnpm install
# Create the R2 bucket for dbt artifacts (one time)
wrangler r2 bucket create dbt-artifacts-modeling
```

Push the Snowflake credentials as Worker secrets. The private key is
passed as PEM content (`SNOWFLAKE_PRIVATE_KEY`) so no `.p8` file is
ever baked into the container image:

```bash
wrangler secret put SNOWFLAKE_ACCOUNT
wrangler secret put SNOWFLAKE_USER
wrangler secret put SNOWFLAKE_PRIVATE_KEY < ~/.ssh/snowflake_rsa_key.p8
wrangler secret put SNOWFLAKE_PRIVATE_KEY_PASSPHRASE   # optional
wrangler secret put SNOWFLAKE_ROLE
wrangler secret put SNOWFLAKE_WAREHOUSE
wrangler secret put SNOWFLAKE_DATABASE
wrangler secret put SNOWFLAKE_SCHEMA
wrangler secret put API_KEY
```

At container startup `server.py`'s `bootstrap_private_key()` writes
`SNOWFLAKE_PRIVATE_KEY` to `/tmp/snowflake_rsa_key.p8` and sets
`SNOWFLAKE_PRIVATE_KEY_PATH` so `profiles.yml` picks it up without any
extra env-substitution logic.

### Deploy

```bash
pnpm deploy    # wrangler deploy
```

### Invoke

```bash
# Health (no auth)
curl https://<your-worker>.workers.dev/health

# dbt run (authenticated)
curl -X POST https://<your-worker>.workers.dev/run \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"target": "prod", "select": "tag:datavault"}'

# /test, /build, /docs follow the same shape.
```

### Security notes

- Non-root `appuser` inside the container.
- The private key file lives in `/tmp` with `0600` perms and is only
  readable by `appuser`.
- All POST endpoints require `Authorization: Bearer <API_KEY>`.
- Outbound HTTP to R2 goes through an in-worker proxy
  (`http://r2.worker`) instead of signed URLs.
