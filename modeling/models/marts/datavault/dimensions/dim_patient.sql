{{ config(materialized='table') }}

-- Patient conformed dimension. Combines the current-version
-- sat_patient_details record with the patient_visit_summary
-- metrics so BI tools get demographics + KPIs in a single row.

WITH hub AS (
    SELECT
        hk_patient_h,
        patient_id,
        {{ datavault4dbt.ldts_alias() }} AS hub_ldts
    FROM {{ ref('hub_patient') }}
),

sat_latest AS (
    SELECT
        hk_patient_h,
        first_name,
        last_name,
        date_of_birth,
        gender,
        address,
        phone,
        {{ datavault4dbt.ldts_alias() }} AS sat_ldts,
        ROW_NUMBER() OVER (
            PARTITION BY hk_patient_h
            ORDER BY {{ datavault4dbt.ldts_alias() }} DESC
        ) AS rn
    FROM {{ ref('sat_patient_details') }}
),

visit_summary AS (
    SELECT
        hk_patient_h,
        total_visits,
        distinct_doctors,
        total_treatment_cost,
        first_visit_date,
        last_visit_date,
        distinct_medications
    FROM {{ ref('sat_patient_visit_summary') }}
)

SELECT
    h.hk_patient_h,
    h.patient_id,
    s.first_name,
    s.last_name,
    s.first_name || ' ' || s.last_name AS full_name,
    s.date_of_birth,
    s.gender,
    s.address,
    s.phone,
    COALESCE(vs.total_visits, 0) AS total_visits,
    COALESCE(vs.distinct_doctors, 0) AS distinct_doctors,
    COALESCE(vs.total_treatment_cost, 0) AS total_treatment_cost,
    vs.first_visit_date,
    vs.last_visit_date,
    COALESCE(vs.distinct_medications, 0) AS distinct_medications,
    h.hub_ldts,
    s.sat_ldts
FROM hub h
INNER JOIN sat_latest s
    ON h.hk_patient_h = s.hk_patient_h
    AND s.rn = 1
LEFT JOIN visit_summary vs
    ON h.hk_patient_h = vs.hk_patient_h
