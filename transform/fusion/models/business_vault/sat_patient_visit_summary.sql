WITH patient_visits AS (
    SELECT
        lv.PATIENT_HK,
        lv.VISIT_HK,
        lv.DOCTOR_HK,
        svd.DIAGNOSIS_CODE,
        svd.TREATMENT_COST,
        svd.LOAD_DATETIME
    FROM {{ ref('link_visit') }} lv
    INNER JOIN {{ ref('sat_visit_details') }} svd
        ON lv.VISIT_HK = svd.VISIT_HK
),

patient_prescriptions AS (
    SELECT
        lv.PATIENT_HK,
        lp.MEDICATION_HK
    FROM {{ ref('link_visit') }} lv
    INNER JOIN {{ ref('link_prescription') }} lp
        ON lv.VISIT_HK = lp.VISIT_HK
),

visit_summary AS (
    SELECT
        PATIENT_HK,
        COUNT(DISTINCT VISIT_HK) AS TOTAL_VISITS,
        COUNT(DISTINCT DOCTOR_HK) AS DISTINCT_DOCTORS,
        COUNT(DISTINCT DIAGNOSIS_CODE) AS DISTINCT_DIAGNOSES,
        SUM(CAST(TREATMENT_COST AS DECIMAL(10, 2))) AS TOTAL_TREATMENT_COST,
        AVG(CAST(TREATMENT_COST AS DECIMAL(10, 2))) AS AVG_TREATMENT_COST,
        MIN(LOAD_DATETIME) AS FIRST_VISIT_DATE,
        MAX(LOAD_DATETIME) AS LAST_VISIT_DATE
    FROM patient_visits
    GROUP BY PATIENT_HK
),

prescription_summary AS (
    SELECT
        PATIENT_HK,
        COUNT(DISTINCT MEDICATION_HK) AS DISTINCT_MEDICATIONS
    FROM patient_prescriptions
    GROUP BY PATIENT_HK
)

SELECT
    vs.PATIENT_HK,
    vs.TOTAL_VISITS,
    vs.DISTINCT_DOCTORS,
    vs.DISTINCT_DIAGNOSES,
    vs.TOTAL_TREATMENT_COST,
    vs.AVG_TREATMENT_COST,
    vs.FIRST_VISIT_DATE,
    vs.LAST_VISIT_DATE,
    COALESCE(ps.DISTINCT_MEDICATIONS, 0) AS DISTINCT_MEDICATIONS,
    CURRENT_TIMESTAMP() AS LOAD_DATETIME,
    'COMPUTED' AS RECORD_SOURCE
FROM visit_summary vs
LEFT JOIN prescription_summary ps
    ON vs.PATIENT_HK = ps.PATIENT_HK
