terraform {
  required_version = ">= 1.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }

  # Backend configuration (optional - uncomment to use Terraform Cloud or S3)
  # backend "s3" {
  #   bucket = "your-terraform-state-bucket"
  #   key    = "cloudflare/github-workers/terraform.tfstate"
  #   region = "us-east-1"
  # }
}

provider "cloudflare" {
  # API token is read from CLOUDFLARE_API_TOKEN environment variable
  # Or can be set explicitly:
  # api_token = var.cloudflare_api_token
}

# R2 Bucket for raw data
resource "cloudflare_r2_bucket" "data_lake_raw" {
  account_id = var.cloudflare_account_id
  name       = "data-lake-raw"
  location   = "APAC" # Asia-Pacific region
}

# R2 Bucket for preview/testing (optional)
resource "cloudflare_r2_bucket" "data_lake_raw_preview" {
  account_id = var.cloudflare_account_id
  name       = "data-lake-raw-preview"
  location   = "APAC"
}

# Queue for GitHub fetch tasks
resource "cloudflare_queue" "github_fetch_queue" {
  account_id = var.cloudflare_account_id
  name       = "github-fetch-queue"
}

# Dead Letter Queue for failed messages
resource "cloudflare_queue" "github_fetch_dlq" {
  account_id = var.cloudflare_account_id
  name       = "github-fetch-dlq"
}

# KV Namespace for metadata storage
resource "cloudflare_workers_kv_namespace" "metadata" {
  account_id = var.cloudflare_account_id
  title      = "METADATA_KV"
}

# KV Namespace for production environment
resource "cloudflare_workers_kv_namespace" "metadata_production" {
  account_id = var.cloudflare_account_id
  title      = "METADATA_KV_PRODUCTION"
}

# Analytics Engine dataset (implicit - created automatically when used)
# No Terraform resource needed for Analytics Engine

# Worker: GitHub Scheduler
resource "cloudflare_worker_script" "github_scheduler" {
  account_id = var.cloudflare_account_id
  name       = "github-scheduler"
  content    = file("${path.module}/../workers/github-scheduler/src/index.ts")

  # KV Namespace binding
  kv_namespace_binding {
    name         = "METADATA_KV"
    namespace_id = cloudflare_workers_kv_namespace.metadata.id
  }

  # Queue Producer binding
  queue_binding {
    binding = "GITHUB_QUEUE"
    queue   = cloudflare_queue.github_fetch_queue.name
  }

  # Analytics Engine binding
  analytics_engine_binding {
    name = "ANALYTICS"
  }

  # Secret bindings (must be set manually via wrangler)
  # GITHUB_TOKEN - set via: wrangler secret put GITHUB_TOKEN --name github-scheduler

  plain_text_binding {
    name = "ENVIRONMENT"
    text = var.environment
  }
}

# Worker: GitHub Fetcher
resource "cloudflare_worker_script" "github_fetcher" {
  account_id = var.cloudflare_account_id
  name       = "github-fetcher"
  content    = file("${path.module}/../workers/github-fetcher/src/index.ts")

  # R2 Bucket binding
  r2_bucket_binding {
    name        = "RAW_BUCKET"
    bucket_name = cloudflare_r2_bucket.data_lake_raw.name
  }

  # Analytics Engine binding
  analytics_engine_binding {
    name = "ANALYTICS"
  }

  # Secret bindings (must be set manually via wrangler)
  # GITHUB_TOKEN - set via: wrangler secret put GITHUB_TOKEN --name github-fetcher

  plain_text_binding {
    name = "ENVIRONMENT"
    text = var.environment
  }
}

# Queue Consumer binding for GitHub Fetcher
resource "cloudflare_queue_consumer" "github_fetcher" {
  account_id = var.cloudflare_account_id
  queue_id   = cloudflare_queue.github_fetch_queue.id

  settings {
    batch_size      = 10
    max_retries     = 3
    max_wait_time   = 30
    retry_delay     = 60
    visibility_timeout_ms = 300000 # 5 minutes
  }

  script_name = cloudflare_worker_script.github_fetcher.name
  environment = var.environment

  dead_letter_queue = cloudflare_queue.github_fetch_dlq.name
}

# Cron Trigger for Scheduler Worker
resource "cloudflare_worker_cron_trigger" "github_scheduler_daily" {
  account_id  = var.cloudflare_account_id
  script_name = cloudflare_worker_script.github_scheduler.name
  schedules = [
    "0 2 * * *" # Daily at 2:00 AM UTC (11:00 AM JST)
  ]
}

# Worker Route for HTTP access (optional)
resource "cloudflare_worker_route" "github_scheduler_route" {
  count = var.enable_worker_routes ? 1 : 0

  zone_id     = var.cloudflare_zone_id
  pattern     = "github-scheduler.${var.domain}/*"
  script_name = cloudflare_worker_script.github_scheduler.name
}
