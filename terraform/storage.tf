# ========================================
# R2 Object Storage Buckets
# ========================================

resource "cloudflare_r2_bucket" "buckets" {
  for_each = var.r2_buckets

  account_id = var.cloudflare_account_id
  name       = "${var.project_name}-${each.key}-${var.environment}"
  location   = each.value.location
}

# ========================================
# D1 Databases
# ========================================

resource "cloudflare_d1_database" "databases" {
  for_each = var.d1_databases

  account_id = var.cloudflare_account_id
  name       = "${var.project_name}-${each.key}-${var.environment}"
}

# ========================================
# Workers KV Namespaces
# ========================================

resource "cloudflare_workers_kv_namespace" "namespaces" {
  for_each = var.kv_namespaces

  account_id = var.cloudflare_account_id
  title      = "${var.project_name}-${each.key}-${var.environment}"
}

# ========================================
# Analytics Engine Datasets
# ========================================

# Note: Analytics Engine datasets are created automatically when first written to
# No explicit Terraform resource needed, but documented here for reference
#
# Datasets to be used:
# - pipeline-metrics
# - user-events
# - application-logs
#
# Write to them using Workers bindings in workers.tf
