# Streamlit Dashboard for Cloudflare Containers
# Base image with digest pinning for security
FROM python:3.11-slim

# Security: Create non-root user
RUN groupadd --gid 1000 streamlit \
    && useradd --uid 1000 --gid streamlit --shell /bin/bash --create-home streamlit

# System dependencies (minimal)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Python dependencies
WORKDIR /app
COPY container/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code
COPY --chown=streamlit:streamlit container/app/ /app/

# Create data directory for R2 mount
RUN mkdir -p /data && chown streamlit:streamlit /data

# Switch to non-root user
USER streamlit

# Environment variables
ENV STREAMLIT_SERVER_PORT=8501
ENV STREAMLIT_SERVER_ADDRESS=0.0.0.0
ENV STREAMLIT_SERVER_HEADLESS=true
ENV STREAMLIT_BROWSER_GATHER_USAGE_STATS=false
ENV DATA_PATH=/data

# Expose Streamlit port
EXPOSE 8501

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8501/_stcore/health || exit 1

# Run Streamlit
CMD ["streamlit", "run", "main.py", "--server.port=8501", "--server.address=0.0.0.0"]
