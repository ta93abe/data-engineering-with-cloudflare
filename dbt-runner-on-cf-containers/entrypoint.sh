#!/bin/bash
set -euo pipefail

# Clone repo
git clone --depth 1 --branch "${GIT_REF:-main}" \
  "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git" /app/repo

cd /app/repo/transform/core

# Write R2 credentials for DuckDB httpfs
cat > .env <<EOF
R2_ENDPOINT=${R2_ENDPOINT}
R2_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}
R2_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}
EOF

set -a && source .env && set +a

# Install dbt packages and run build (seed + run + test)
dbt deps --profiles-dir . --target ci
dbt build --profiles-dir . --target ci

echo "=== dbt complete ==="
