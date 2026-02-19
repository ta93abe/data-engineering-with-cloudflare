{{ config(materialized='table') }}

WITH patient_visits AS (
    SELECT
        lv.LINK_VISIT_HK,
        lv.PATIENT_HK,
        lv.VISIT_HK
    FROM {{ ref('link_visit') }} lv
),

visit_prescriptions AS (
    SELECT
        lp.LINK_PRESCRIPTION_HK,
        lp.VISIT_HK,
        lp.MEDICATION_HK
    FROM {{ ref('link_prescription') }} lp
)

SELECT
    pv.PATIENT_HK,
    pv.LINK_VISIT_HK,
    pv.VISIT_HK,
    vp.LINK_PRESCRIPTION_HK,
    vp.MEDICATION_HK
FROM patient_visits pv
INNER JOIN visit_prescriptions vp
    ON pv.VISIT_HK = vp.VISIT_HK
