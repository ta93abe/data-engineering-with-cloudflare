INSERT INTO linear_events_sink
SELECT
  action,
  type,
  created_at,
  webhook_id,
  webhook_timestamp,
  organization_id,
  url,
  actor,
  data,
  updated_from
FROM linear_events
