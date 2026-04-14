{{ config(materialized='table') }}

WITH hub AS (
    SELECT
        hk_doctor_h,
        doctor_id,
        {{ datavault4dbt.ldts_alias() }} AS hub_ldts
    FROM {{ ref('hub_doctor') }}
),

sat_latest AS (
    SELECT
        hk_doctor_h,
        first_name,
        last_name,
        specialty,
        license_number,
        {{ datavault4dbt.ldts_alias() }} AS sat_ldts,
        ROW_NUMBER() OVER (
            PARTITION BY hk_doctor_h
            ORDER BY {{ datavault4dbt.ldts_alias() }} DESC
        ) AS rn
    FROM {{ ref('sat_doctor_details') }}
)

SELECT
    h.hk_doctor_h,
    h.doctor_id,
    s.first_name,
    s.last_name,
    s.first_name || ' ' || s.last_name AS full_name,
    s.specialty,
    s.license_number,
    h.hub_ldts,
    s.sat_ldts
FROM hub h
INNER JOIN sat_latest s
    ON h.hk_doctor_h = s.hk_doctor_h
    AND s.rn = 1
