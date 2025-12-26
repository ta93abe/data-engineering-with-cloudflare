{{
  config(
    materialized='table',
    tags=['marts', 'analytics']
  )
}}

/*
  Fact table: User Posts

  This mart model combines users and their posts for analytics.
  Gold layer data optimized for reporting and dashboards.
*/

WITH users AS (
  SELECT * FROM {{ ref('stg_api_users') }}
),

posts AS (
  SELECT * FROM {{ ref('stg_api_posts') }}
),

user_post_metrics AS (
  SELECT
    u.user_id,
    u.user_name,
    u.username,
    u.email,

    -- Post metrics
    COUNT(p.post_id) AS total_posts,
    AVG(LENGTH(p.body)) AS avg_post_length,
    MAX(LENGTH(p.body)) AS max_post_length,
    MIN(LENGTH(p.body)) AS min_post_length,

    -- Metadata
    MAX(p.loaded_at) AS last_post_loaded_at,
    CURRENT_TIMESTAMP AS calculated_at

  FROM users u
  LEFT JOIN posts p ON u.user_id = p.user_id
  GROUP BY 1, 2, 3, 4
)

SELECT * FROM user_post_metrics
