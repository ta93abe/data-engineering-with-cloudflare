{{ config(materialized='table') }}

WITH hub AS (
    SELECT
        hk_medication_h,
        medication_id,
        {{ datavault4dbt.ldts_alias() }} AS hub_ldts
    FROM {{ ref('hub_medication') }}
),

sat_latest AS (
    SELECT
        hk_medication_h,
        medication_name,
        type,
        manufacturer,
        unit_price,
        {{ datavault4dbt.ldts_alias() }} AS sat_ldts,
        ROW_NUMBER() OVER (
            PARTITION BY hk_medication_h
            ORDER BY {{ datavault4dbt.ldts_alias() }} DESC
        ) AS rn
    FROM {{ ref('sat_medication_details') }}
)

SELECT
    h.hk_medication_h,
    h.medication_id,
    s.medication_name,
    s.type AS medication_type,
    s.manufacturer,
    CAST(s.unit_price AS DECIMAL(10, 2)) AS unit_price,
    h.hub_ldts,
    s.sat_ldts
FROM hub h
INNER JOIN sat_latest s
    ON h.hk_medication_h = s.hk_medication_h
    AND s.rn = 1
