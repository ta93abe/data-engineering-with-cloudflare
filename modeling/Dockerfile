FROM python:3.12-slim

WORKDIR /app

# Install uv (pinned version)
COPY --from=ghcr.io/astral-sh/uv:0.11.2 /uv /usr/local/bin/uv

# Copy dependency files first for layer caching
COPY pyproject.toml uv.lock ./

RUN uv sync --no-dev --frozen

# Copy dbt project
COPY dbt_project.yml packages.yml profiles.yml ./
COPY models/ ./models/
COPY macros/ ./macros/

# Install dbt packages
RUN uv run dbt deps

# Copy HTTP server
COPY server.py ./server.py

# Non-root user
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app
USER appuser

EXPOSE 8080

CMD ["uv", "run", "python", "server.py"]
