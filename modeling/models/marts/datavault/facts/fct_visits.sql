{{ config(materialized='table') }}

-- Visit fact table at the granularity of one row per visit.

WITH visit_link AS (
    SELECT
        hk_visit_l,
        hk_visit_h,
        hk_patient_h,
        hk_doctor_h
    FROM {{ ref('link_visit') }}
),

visit_sat AS (
    SELECT
        hk_visit_h,
        visit_date,
        diagnosis_code,
        diagnosis_name,
        notes,
        treatment_cost,
        ROW_NUMBER() OVER (
            PARTITION BY hk_visit_h
            ORDER BY {{ datavault4dbt.ldts_alias() }} DESC
        ) AS rn
    FROM {{ ref('sat_visit_details') }}
)

SELECT
    vl.hk_visit_l,
    vl.hk_visit_h,
    vl.hk_patient_h,
    vl.hk_doctor_h,
    CAST(vs.visit_date AS DATE) AS visit_date,
    vs.diagnosis_code,
    vs.diagnosis_name,
    vs.notes,
    CAST(vs.treatment_cost AS DECIMAL(12, 2)) AS treatment_cost
FROM visit_link vl
INNER JOIN visit_sat vs
    ON vl.hk_visit_h = vs.hk_visit_h
    AND vs.rn = 1
