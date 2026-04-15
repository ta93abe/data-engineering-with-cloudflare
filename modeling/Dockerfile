FROM python:3.12-slim

WORKDIR /app

# Install uv (pinned version)
COPY --from=ghcr.io/astral-sh/uv:0.11.2 /uv /usr/local/bin/uv

# Have uv compile .pyc on install so cold-start import time isn't
# spent byte-compiling dbt + snowflake-connector + pyarrow.
ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

# Copy dependency files first for layer caching
COPY pyproject.toml uv.lock ./

RUN uv sync --no-dev --frozen

# Copy dbt project
COPY dbt_project.yml packages.yml profiles.yml ./
COPY models/ ./models/
COPY macros/ ./macros/

# Install dbt packages
RUN uv run dbt deps

# Pre-compile any straggling .py files (dbt_packages, macros, models)
# so the first request after a cold start doesn't take the
# byte-compile penalty.
RUN .venv/bin/python -m compileall -q .venv dbt_packages 2>/dev/null || true

# Copy HTTP server
COPY server.py ./server.py
RUN .venv/bin/python -m compileall -q server.py 2>/dev/null || true

# Non-root user
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app
USER appuser

EXPOSE 8080

CMD ["uv", "run", "python", "server.py"]
