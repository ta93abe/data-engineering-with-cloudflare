{{
  config(
    materialized='view',
    tags=['staging', 'api_data']
  )
}}

/*
  Staging model for JSONPlaceholder API users data

  This model reads raw user data from R2 Bronze layer and
  flattens nested JSON structures.
*/

WITH source AS (
  SELECT
    *
  FROM read_parquet('s3://{{ env_var("R2_BUCKET_NAME", "data-lake-raw") }}/sources/api_jsonplaceholder/users/**/*.parquet')
),

cleaned AS (
  SELECT
    -- Primary key
    CAST(id AS INTEGER) AS user_id,

    -- User attributes
    CAST(name AS VARCHAR) AS user_name,
    CAST(username AS VARCHAR) AS username,
    CAST(email AS VARCHAR) AS email,
    CAST(phone AS VARCHAR) AS phone,
    CAST(website AS VARCHAR) AS website,

    -- Address (nested JSON)
    -- Note: DuckDBはJSON関数をサポート。実際のスキーマに応じて調整が必要
    CAST(address AS JSON) AS address_json,

    -- Company (nested JSON)
    CAST(company AS JSON) AS company_json,

    -- Metadata
    CURRENT_TIMESTAMP AS loaded_at

  FROM source
)

SELECT * FROM cleaned
