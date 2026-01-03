output "r2_bucket_name" {
  description = "Name of the R2 bucket for raw data"
  value       = cloudflare_r2_bucket.data_lake_raw.name
}

output "r2_bucket_preview_name" {
  description = "Name of the R2 bucket for preview/testing"
  value       = cloudflare_r2_bucket.data_lake_raw_preview.name
}

output "queue_name" {
  description = "Name of the GitHub fetch queue"
  value       = cloudflare_queue.github_fetch_queue.name
}

output "queue_id" {
  description = "ID of the GitHub fetch queue"
  value       = cloudflare_queue.github_fetch_queue.id
}

output "dlq_name" {
  description = "Name of the dead letter queue"
  value       = cloudflare_queue.github_fetch_dlq.name
}

output "kv_namespace_id" {
  description = "ID of the KV namespace for metadata"
  value       = cloudflare_workers_kv_namespace.metadata.id
}

output "kv_namespace_production_id" {
  description = "ID of the production KV namespace for metadata"
  value       = cloudflare_workers_kv_namespace.metadata_production.id
}

output "scheduler_worker_name" {
  description = "Name of the scheduler worker"
  value       = cloudflare_worker_script.github_scheduler.name
}

output "fetcher_worker_name" {
  description = "Name of the fetcher worker"
  value       = cloudflare_worker_script.github_fetcher.name
}

output "scheduler_worker_url" {
  description = "URL for the scheduler worker (if routes enabled)"
  value       = var.enable_worker_routes ? "https://github-scheduler.${var.domain}" : "Route not enabled"
}

output "manual_steps_required" {
  description = "Manual steps that need to be completed"
  value = <<-EOT
    The following manual steps are required:

    1. Set GitHub Token secrets:
       wrangler secret put GITHUB_TOKEN --name github-scheduler
       wrangler secret put GITHUB_TOKEN --name github-fetcher

    2. Update wrangler.toml files with resource IDs:
       - KV Namespace ID: ${cloudflare_workers_kv_namespace.metadata.id}
       - KV Production ID: ${cloudflare_workers_kv_namespace.metadata_production.id}
       - R2 Bucket: ${cloudflare_r2_bucket.data_lake_raw.name}
       - Queue: ${cloudflare_queue.github_fetch_queue.name}

    3. Deploy Workers:
       cd workers/github-scheduler && wrangler deploy
       cd workers/github-fetcher && wrangler deploy

    See docs/SETUP_TODO.md for detailed instructions.
  EOT
}
