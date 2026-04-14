{{ config(materialized='table') }}

-- Conformed date dimension generated with dbt_utils.date_spine.
-- Covers 2020-01-01 through 2030-12-31 which comfortably spans
-- the current seed data range.

WITH date_spine AS (
    {{ dbt_utils.date_spine(
        datepart="day",
        start_date="cast('2020-01-01' as date)",
        end_date="cast('2031-01-01' as date)"
    ) }}
)

SELECT
    CAST(date_day AS DATE) AS date_key,
    date_day AS full_date,
    EXTRACT(YEAR FROM date_day) AS year,
    EXTRACT(QUARTER FROM date_day) AS quarter,
    EXTRACT(MONTH FROM date_day) AS month,
    EXTRACT(DAY FROM date_day) AS day_of_month,
    EXTRACT(DAYOFWEEK FROM date_day) AS day_of_week,
    EXTRACT(WEEK FROM date_day) AS week_of_year,
    TO_CHAR(date_day, 'YYYY-MM') AS year_month,
    TO_CHAR(date_day, 'Dy') AS day_name_short,
    TO_CHAR(date_day, 'Mon') AS month_name_short,
    CASE
        WHEN EXTRACT(DAYOFWEEK FROM date_day) IN (0, 6) THEN TRUE
        ELSE FALSE
    END AS is_weekend
FROM date_spine
