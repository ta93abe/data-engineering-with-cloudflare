{{
  config(
    materialized='view',
    tags=['staging', 'api_data']
  )
}}

/*
  Staging model for JSONPlaceholder API posts data

  This model reads raw data from R2 Bronze layer and applies
  basic transformations and standardization.
*/

WITH source AS (
  SELECT
    *
  FROM read_parquet('s3://{{ env_var("R2_BUCKET_NAME", "data-lake-raw") }}/sources/api_jsonplaceholder/posts/**/*.parquet')
),

cleaned AS (
  SELECT
    -- Primary key
    CAST(id AS INTEGER) AS post_id,

    -- Foreign keys
    CAST(userId AS INTEGER) AS user_id,

    -- Attributes
    CAST(title AS VARCHAR) AS title,
    CAST(body AS VARCHAR) AS body,

    -- Metadata
    CURRENT_TIMESTAMP AS loaded_at

  FROM source
)

SELECT * FROM cleaned
