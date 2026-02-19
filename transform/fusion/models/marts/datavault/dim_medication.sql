{{ config(materialized='table') }}

{#
  Dimension: dim_medication
  Hub + Satellite → フラットなディメンション
#}

WITH hub AS (
    SELECT
        MEDICATION_HK,
        MEDICATION_ID,
        LOAD_DATETIME AS HUB_LOAD_DATETIME
    FROM {{ ref('hub_medication') }}
),

sat_latest AS (
    SELECT
        MEDICATION_HK,
        MEDICATION_NAME,
        TYPE,
        MANUFACTURER,
        UNIT_PRICE,
        LOAD_DATETIME AS SAT_LOAD_DATETIME,
        ROW_NUMBER() OVER (
            PARTITION BY MEDICATION_HK
            ORDER BY LOAD_DATETIME DESC
        ) AS rn
    FROM {{ ref('sat_medication_details') }}
)

SELECT
    h.MEDICATION_HK,
    h.MEDICATION_ID,
    s.MEDICATION_NAME,
    s.TYPE AS MEDICATION_TYPE,
    s.MANUFACTURER,
    CAST(s.UNIT_PRICE AS DECIMAL(10, 2)) AS UNIT_PRICE,
    h.HUB_LOAD_DATETIME,
    s.SAT_LOAD_DATETIME
FROM hub h
INNER JOIN sat_latest s
    ON h.MEDICATION_HK = s.MEDICATION_HK
    AND s.rn = 1
