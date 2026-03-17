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

# Install dbt packages
dbt deps --profiles-dir . --target ci

# Run dbt commands (default: seed, run, test)
IFS=',' read -ra CMDS <<< "${DBT_COMMANDS:-seed,run,test}"
for cmd in "${CMDS[@]}"; do
  echo "=== dbt $cmd ==="
  dbt "$cmd" --profiles-dir . --target ci
done

echo "=== dbt complete ==="
