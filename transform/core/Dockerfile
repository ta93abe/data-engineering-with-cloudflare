FROM python:3.12-slim

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy dependency files first for layer caching
COPY pyproject.toml uv.lock ./

RUN uv sync --no-dev --frozen

# Copy dbt project
COPY dbt_project.yml packages.yml profiles.yml ./
COPY models/ ./models/
COPY macros/ ./macros/
COPY seeds/ ./seeds/
COPY tests/ ./tests/
COPY analyses/ ./analyses/
COPY snapshots/ ./snapshots/

# Install dbt packages
RUN uv run dbt deps

# Copy HTTP server
COPY server.py ./server.py

EXPOSE 8080

CMD ["uv", "run", "python", "server.py"]
