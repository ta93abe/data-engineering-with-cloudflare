WITH date_series AS (
    SELECT EXPLODE(SEQUENCE(
        CAST('{{ var("dim_date_start", "2024-01-01") }}' AS DATE),
        CAST('{{ var("dim_date_end", "2026-12-31") }}' AS DATE),
        INTERVAL 1 DAY
    )) AS date_day
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
