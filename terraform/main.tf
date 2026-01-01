terraform {
  required_version = ">= 1.5.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }

  # Backend設定（必要に応じてコメント解除）
  # backend "s3" {
  #   bucket                      = "terraform-state-bucket"
  #   key                         = "cloudflare-data-platform/terraform.tfstate"
  #   region                      = "auto"
  #   endpoint                    = "https://<account-id>.r2.cloudflarestorage.com"
  #   skip_credentials_validation = true
  #   skip_region_validation      = true
  #   skip_metadata_api_check     = true
  # }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
