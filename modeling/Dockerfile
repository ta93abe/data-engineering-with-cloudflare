FROM docker.io/cloudflare/sandbox:0.7.0

# Install uv into a stable location. The base image does not ship
# uv, but has curl + Python 3.11 which is enough for our pins
# (modeling/pyproject.toml requires python >=3.11,<3.13).
RUN curl -LsSf https://astral.sh/uv/install.sh | sh && \
    cp /root/.local/bin/uv /usr/local/bin/uv && \
    cp /root/.local/bin/uvx /usr/local/bin/uvx

# uv optimizations for container reuse:
#  - COMPILE_BYTECODE = precompile .pyc at install time so cold
#    start doesn't byte-compile on first import.
#  - LINK_MODE=copy works around overlayfs quirks in rootless
#    containers.
#  - CACHE_DIR at a stable path so the runtime `uv sync` (inside
#    the git-cloned repo) can reuse the warm cache from the image.
ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy
ENV UV_CACHE_DIR=/opt/uv-cache

# Pre-warm the uv package cache with the dbt dependency tree so
# the first dbt run after a cold start does not pay the full
# download + install penalty. We throw away the resulting .venv
# since the real one will be built inside the git-cloned
# workspace, but the package cache layer survives.
WORKDIR /tmp/prefetch
COPY pyproject.toml uv.lock ./
RUN uv sync --no-dev --frozen && rm -rf /tmp/prefetch

WORKDIR /workspace

EXPOSE 8080
