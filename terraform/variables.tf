variable "cloudflare_api_token" {
  description = "Cloudflare API Token with appropriate permissions"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare Account ID"
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare Zone ID (optional, for DNS/routing)"
  type        = string
  default     = ""
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "project_name" {
  description = "Project name prefix for resources"
  type        = string
  default     = "data-engineering"
}

# R2 Buckets Configuration
variable "r2_buckets" {
  description = "R2 buckets to create"
  type = map(object({
    location = optional(string, "apac")
  }))
  default = {
    "data-lake-raw" = {
      location = "apac"
    }
    "data-lake-curated" = {
      location = "apac"
    }
    "data-lake-bronze" = {
      location = "apac"
    }
    "data-lake-silver" = {
      location = "apac"
    }
    "data-lake-gold" = {
      location = "apac"
    }
    "terraform-state" = {
      location = "apac"
    }
  }
}

# D1 Databases Configuration
variable "d1_databases" {
  description = "D1 databases to create"
  type        = map(object({}))
  default = {
    "pipeline-metadata" = {}
    "data-quality"      = {}
    "user-profiles"     = {}
  }
}

# KV Namespaces Configuration
variable "kv_namespaces" {
  description = "KV namespaces to create"
  type        = map(object({}))
  default = {
    "pipeline-state" = {}
    "session-store"  = {}
    "config-cache"   = {}
  }
}

# Workers Analytics Engine Configuration
variable "analytics_engine_datasets" {
  description = "Analytics Engine datasets to create"
  type        = list(string)
  default = [
    "pipeline-metrics",
    "user-events",
    "application-logs"
  ]
}

# Queue Configuration
variable "queues" {
  description = "Cloudflare Queues to create"
  type = map(object({
    max_retries            = optional(number, 3)
    max_batch_size         = optional(number, 100)
    max_batch_timeout      = optional(number, 30)
    max_message_size       = optional(number, 128)
    delivery_delay_seconds = optional(number, 0)
  }))
  default = {
    "data-processing" = {
      max_retries       = 3
      max_batch_size    = 100
      max_batch_timeout = 30
    }
    "pipeline-tasks" = {
      max_retries       = 5
      max_batch_size    = 50
      max_batch_timeout = 60
    }
  }
}

# Workers Configuration
variable "workers_compatibility_date" {
  description = "Compatibility date for all Workers"
  type        = string
  default     = "2024-12-01"
}

variable "workers_python_enabled" {
  description = "Enable Python Workers runtime"
  type        = bool
  default     = true
}
