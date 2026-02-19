{{ config(materialized='table') }}

{#
  Dimension: dim_date
  診察データの日付範囲をカバーする日付ディメンション。
  Raw Vault のデータからは生成せず、必要な範囲を動的に生成する。
#}

WITH date_range AS (
    -- 診察データの日付範囲を取得
    SELECT
        MIN(CAST(EFFECTIVE_FROM AS DATE)) AS min_date,
        MAX(CAST(EFFECTIVE_FROM AS DATE)) AS max_date
    FROM {{ ref('sat_visit_details') }}
),

-- Databricks の SEQUENCE 関数で日付配列を生成
date_series AS (
    SELECT EXPLODE(SEQUENCE(min_date, max_date, INTERVAL 1 DAY)) AS date_day
    FROM date_range
)

SELECT
    CAST(date_day AS DATE) AS DATE_KEY,
    YEAR(date_day) AS YEAR,
    MONTH(date_day) AS MONTH,
    DAY(date_day) AS DAY_OF_MONTH,
    DAYOFWEEK(date_day) AS DAY_OF_WEEK,
    CASE DAYOFWEEK(date_day)
        WHEN 1 THEN '日'
        WHEN 2 THEN '月'
        WHEN 3 THEN '火'
        WHEN 4 THEN '水'
        WHEN 5 THEN '木'
        WHEN 6 THEN '金'
        WHEN 7 THEN '土'
    END AS DAY_NAME_JP,
    WEEKOFYEAR(date_day) AS WEEK_OF_YEAR,
    QUARTER(date_day) AS QUARTER,
    CASE
        WHEN DAYOFWEEK(date_day) IN (1, 7) THEN FALSE
        ELSE TRUE
    END AS IS_WEEKDAY,
    DATE_FORMAT(date_day, 'yyyy-MM') AS YEAR_MONTH
FROM date_series
