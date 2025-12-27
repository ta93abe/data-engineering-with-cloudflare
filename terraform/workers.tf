# ========================================
# Cloudflare Workers Scripts
# ========================================

# Note: Workers can be managed in two ways:
# 1. Terraform only (uncomment resources below)
# 2. Wrangler CLI (recommended for development, uses wrangler.toml)
#
# This file provides Terraform definitions that mirror wrangler.toml configuration.
# For production, consider using Wrangler for deployment while using Terraform
# for infrastructure resources (R2, D1, KV, Queues).

# ========================================
# Option 1: Terraform-managed Workers
# ========================================

# Uncomment to manage Workers via Terraform
# Note: Requires Worker script content to be available

/*
resource "cloudflare_workers_script" "dlt_pipeline" {
  account_id = var.cloudflare_account_id
  name       = "${var.project_name}-dlt-pipeline-${var.environment}"
  content    = file("${path.module}/../workers/ingestion/dlt_pipeline.py")

  # Python Workers configuration
  compatibility_date = var.workers_compatibility_date

  # R2 Bucket Bindings
  r2_bucket_binding {
    name        = "DATA_LAKE"
    bucket_name = cloudflare_r2_bucket.buckets["data-lake-raw"].name
  }

  # D1 Database Bindings
  d1_database_binding {
    name        = "DB"
    database_id = cloudflare_d1_database.databases["pipeline-metadata"].id
  }

  # KV Namespace Bindings
  kv_namespace_binding {
    name         = "PIPELINE_STATE"
    namespace_id = cloudflare_workers_kv_namespace.namespaces["pipeline-state"].id
  }

  # Analytics Engine Binding
  analytics_engine_binding {
    name = "ANALYTICS"
  }

  # Environment Variables
  plain_text_binding {
    name = "R2_ACCOUNT_ID"
    text = var.cloudflare_account_id
  }

  plain_text_binding {
    name = "R2_BUCKET_NAME"
    text = cloudflare_r2_bucket.buckets["data-lake-raw"].name
  }

  # Secrets (manage via wrangler secret put or Terraform secrets)
  # secret_text_binding {
  #   name = "R2_ACCESS_KEY_ID"
  #   text = var.r2_access_key_id
  # }
}

resource "cloudflare_workers_script" "iceberg_converter" {
  account_id = var.cloudflare_account_id
  name       = "${var.project_name}-iceberg-converter-${var.environment}"
  content    = file("${path.module}/../workers/transformation/iceberg_converter.py")

  compatibility_date = var.workers_compatibility_date

  r2_bucket_binding {
    name        = "SOURCE_BUCKET"
    bucket_name = cloudflare_r2_bucket.buckets["data-lake-raw"].name
  }

  r2_bucket_binding {
    name        = "CURATED_BUCKET"
    bucket_name = cloudflare_r2_bucket.buckets["data-lake-curated"].name
  }

  plain_text_binding {
    name = "R2_ACCOUNT_ID"
    text = var.cloudflare_account_id
  }

  plain_text_binding {
    name = "R2_BUCKET_CURATED"
    text = cloudflare_r2_bucket.buckets["data-lake-curated"].name
  }

  plain_text_binding {
    name = "SOURCE_BUCKET"
    text = cloudflare_r2_bucket.buckets["data-lake-raw"].name
  }
}

resource "cloudflare_workers_script" "dlt_iceberg_pipeline" {
  account_id = var.cloudflare_account_id
  name       = "${var.project_name}-dlt-iceberg-pipeline-${var.environment}"
  content    = file("${path.module}/../workers/ingestion/dlt_iceberg_pipeline.py")

  compatibility_date = var.workers_compatibility_date

  r2_bucket_binding {
    name        = "RAW_BUCKET"
    bucket_name = cloudflare_r2_bucket.buckets["data-lake-raw"].name
  }

  r2_bucket_binding {
    name        = "CURATED_BUCKET"
    bucket_name = cloudflare_r2_bucket.buckets["data-lake-curated"].name
  }

  plain_text_binding {
    name = "R2_ACCOUNT_ID"
    text = var.cloudflare_account_id
  }

  plain_text_binding {
    name = "R2_BUCKET_RAW"
    text = cloudflare_r2_bucket.buckets["data-lake-raw"].name
  }

  plain_text_binding {
    name = "R2_BUCKET_CURATED"
    text = cloudflare_r2_bucket.buckets["data-lake-curated"].name
  }
}
*/

# ========================================
# Option 2: Wrangler-managed Workers
# ========================================

# When using Wrangler for Worker deployment, you can still manage
# infrastructure resources (R2, D1, KV) via Terraform and reference
# their IDs in wrangler.toml using outputs from this Terraform configuration.
#
# Workflow:
# 1. Apply Terraform to create R2, D1, KV, Queues
# 2. Use terraform output to get resource IDs
# 3. Update wrangler.toml with resource IDs
# 4. Deploy Workers using: wrangler deploy
#
# Example:
#   terraform apply
#   terraform output kv_namespace_ids
#   # Copy IDs to wrangler.toml
#   wrangler deploy

# ========================================
# Workers Cron Triggers
# ========================================

# Cron triggers for scheduled Workers
# Uncomment when Workers are managed via Terraform

/*
resource "cloudflare_workers_cron_trigger" "dlt_pipeline_daily" {
  account_id  = var.cloudflare_account_id
  script_name = cloudflare_workers_script.dlt_pipeline.name
  schedules = [
    "0 2 * * *",  # Daily at 2 AM UTC
  ]
}

resource "cloudflare_workers_cron_trigger" "iceberg_converter_hourly" {
  account_id  = var.cloudflare_account_id
  script_name = cloudflare_workers_script.iceberg_converter.name
  schedules = [
    "0 * * * *",  # Every hour
  ]
}
*/

# ========================================
# Workers Routes (for HTTP-triggered Workers)
# ========================================

# Uncomment if you need to route specific URLs to Workers
# Requires cloudflare_zone_id to be set

/*
resource "cloudflare_workers_route" "dlt_pipeline_route" {
  zone_id     = var.cloudflare_zone_id
  pattern     = "api.example.com/ingest/*"
  script_name = cloudflare_workers_script.dlt_pipeline.name
}
*/

# ========================================
# Workers Bindings Reference
# ========================================

# This section documents the bindings that should be configured
# in wrangler.toml when using Wrangler-managed Workers

# dlt-pipeline Worker bindings:
# - R2: DATA_LAKE -> data-engineering-data-lake-raw-{env}
# - D1: DB -> data-engineering-pipeline-metadata-{env}
# - KV: PIPELINE_STATE -> data-engineering-pipeline-state-{env}
# - Analytics: ANALYTICS

# iceberg-converter Worker bindings:
# - R2: SOURCE_BUCKET -> data-engineering-data-lake-raw-{env}
# - R2: CURATED_BUCKET -> data-engineering-data-lake-curated-{env}

# dlt-iceberg-pipeline Worker bindings:
# - R2: RAW_BUCKET -> data-engineering-data-lake-raw-{env}
# - R2: CURATED_BUCKET -> data-engineering-data-lake-curated-{env}
