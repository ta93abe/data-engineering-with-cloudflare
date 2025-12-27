# ========================================
# Cloudflare Queues
# ========================================

resource "cloudflare_queue" "queues" {
  for_each = var.queues

  account_id = var.cloudflare_account_id
  name       = "${var.project_name}-${each.key}-${var.environment}"

  # Queue configuration
  # max_retries            = each.value.max_retries
  # max_batch_size         = each.value.max_batch_size
  # max_batch_timeout      = each.value.max_batch_timeout
  # max_message_size       = each.value.max_message_size
  # delivery_delay_seconds = each.value.delivery_delay_seconds

  # Note: Some of these settings may require specific API versions
  # Uncomment and adjust based on provider version capabilities
}

# ========================================
# Queue Consumers (Workers)
# ========================================

# Queue consumers are defined in workers.tf
# Each Worker can consume from queues using queue bindings
