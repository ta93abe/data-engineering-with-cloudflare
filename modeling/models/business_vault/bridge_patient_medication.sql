{{ config(materialized='table') }}

-- Bridge: traverse patient -> visit -> prescription -> medication.
-- Materializes a pre-joined key map so marts don't have to
-- re-compute the multi-hop path every query.

WITH patient_visits AS (
    SELECT
        lv.hk_visit_l,
        lv.hk_patient_h,
        lv.hk_visit_h
    FROM {{ ref('link_visit') }} lv
),

visit_prescriptions AS (
    SELECT
        lp.hk_prescription_l,
        lp.hk_visit_h,
        lp.hk_medication_h
    FROM {{ ref('link_prescription') }} lp
)

SELECT
    pv.hk_patient_h,
    pv.hk_visit_l,
    pv.hk_visit_h,
    vp.hk_prescription_l,
    vp.hk_medication_h
FROM patient_visits pv
INNER JOIN visit_prescriptions vp
    ON pv.hk_visit_h = vp.hk_visit_h
