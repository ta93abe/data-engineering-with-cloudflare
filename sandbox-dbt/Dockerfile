# バージョンは @cloudflare/sandbox npm パッケージと一致させること
FROM docker.io/cloudflare/sandbox:0.7.13-python

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

COPY dbt-project/ /workspace/dbt/
WORKDIR /workspace/dbt

# pyproject.toml + uv.lock から依存関係をインストール
RUN uv sync --frozen --no-dev

RUN uv run dbt deps --profiles-dir . --target ci
