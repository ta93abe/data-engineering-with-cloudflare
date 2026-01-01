output "r2_bucket_names" {
  description = "Names of created R2 buckets"
  value       = { for k, v in cloudflare_r2_bucket.buckets : k => v.name }
}

output "d1_database_ids" {
  description = "IDs of created D1 databases"
  value       = { for k, v in cloudflare_d1_database.databases : k => v.id }
  sensitive   = true
}

output "kv_namespace_ids" {
  description = "IDs of created KV namespaces"
  value       = { for k, v in cloudflare_workers_kv_namespace.namespaces : k => v.id }
  sensitive   = true
}

output "queue_ids" {
  description = "IDs of created Queues"
  value       = { for k, v in cloudflare_queue.queues : k => v.id }
  sensitive   = true
}

output "workers_script_names" {
  description = "Names of deployed Workers scripts"
  value = {
    dlt_pipeline         = try(cloudflare_workers_script.dlt_pipeline.name, null)
    iceberg_converter    = try(cloudflare_workers_script.iceberg_converter.name, null)
    dlt_iceberg_pipeline = try(cloudflare_workers_script.dlt_iceberg_pipeline.name, null)
  }
}

output "account_id" {
  description = "Cloudflare Account ID"
  value       = var.cloudflare_account_id
  sensitive   = true
}

output "environment" {
  description = "Current environment"
  value       = var.environment
}
