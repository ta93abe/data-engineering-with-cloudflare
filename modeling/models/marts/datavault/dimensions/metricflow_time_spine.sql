{{ config(materialized='table') }}

-- Time spine required by the dbt semantic layer / MetricFlow.
-- Covers the same range as dim_date so every metric aggregation
-- has a canonical daily calendar to join against.

WITH spine AS (
    {{ dbt_utils.date_spine(
        datepart="day",
        start_date="cast('2020-01-01' as date)",
        end_date="cast('2031-01-01' as date)"
    ) }}
)

SELECT
    CAST(date_day AS DATE) AS date_day
FROM spine
