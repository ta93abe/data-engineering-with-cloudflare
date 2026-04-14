{{ config(materialized='table') }}

-- Computed (business vault) satellite summarizing per-patient
-- visit activity. Kept separate from sat_patient_details so
-- that raw vault stays immutable while derived metrics can
-- be recomputed independently.

WITH visit_facts AS (
    SELECT
        lv.hk_patient_h,
        lv.hk_visit_h,
        lv.hk_doctor_h,
        svd.visit_date,
        svd.treatment_cost,
        ROW_NUMBER() OVER (
            PARTITION BY lv.hk_visit_h
            ORDER BY svd.ldts DESC
        ) AS rn
    FROM {{ ref('link_visit') }} lv
    INNER JOIN {{ ref('sat_visit_details') }} svd
        ON lv.hk_visit_h = svd.hk_visit_h
),

latest_visit_facts AS (
    SELECT
        hk_patient_h,
        hk_visit_h,
        hk_doctor_h,
        visit_date,
        treatment_cost
    FROM visit_facts
    WHERE rn = 1
),

patient_visit_metrics AS (
    SELECT
        hk_patient_h,
        COUNT(DISTINCT hk_visit_h) AS total_visits,
        COUNT(DISTINCT hk_doctor_h) AS distinct_doctors,
        COALESCE(SUM(treatment_cost), 0) AS total_treatment_cost,
        MIN(visit_date) AS first_visit_date,
        MAX(visit_date) AS last_visit_date
    FROM latest_visit_facts
    GROUP BY hk_patient_h
),

patient_medication_counts AS (
    SELECT
        hk_patient_h,
        COUNT(DISTINCT hk_medication_h) AS distinct_medications
    FROM {{ ref('bridge_patient_medication') }}
    GROUP BY hk_patient_h
)

SELECT
    pvm.hk_patient_h,
    pvm.total_visits,
    pvm.distinct_doctors,
    pvm.total_treatment_cost,
    pvm.first_visit_date,
    pvm.last_visit_date,
    COALESCE(pmc.distinct_medications, 0) AS distinct_medications
FROM patient_visit_metrics pvm
LEFT JOIN patient_medication_counts pmc
    ON pvm.hk_patient_h = pmc.hk_patient_h
