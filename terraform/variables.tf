variable "cloudflare_account_id" {
  description = "Cloudflare Account ID"
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.cloudflare_account_id) == 32
    error_message = "Cloudflare Account ID must be 32 characters long."
  }
}

variable "cloudflare_zone_id" {
  description = "Cloudflare Zone ID (required if enable_worker_routes is true)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "domain" {
  description = "Domain name for worker routes (e.g., example.com)"
  type        = string
  default     = ""
}

variable "environment" {
  description = "Environment name (development, staging, production)"
  type        = string
  default     = "production"

  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "Environment must be one of: development, staging, production."
  }
}

variable "enable_worker_routes" {
  description = "Enable HTTP routes for Workers (requires cloudflare_zone_id and domain)"
  type        = bool
  default     = false
}

variable "r2_location" {
  description = "R2 bucket location (WNAM, ENAM, WEUR, EEUR, APAC)"
  type        = string
  default     = "APAC"

  validation {
    condition     = contains(["WNAM", "ENAM", "WEUR", "EEUR", "APAC"], var.r2_location)
    error_message = "R2 location must be one of: WNAM, ENAM, WEUR, EEUR, APAC."
  }
}
