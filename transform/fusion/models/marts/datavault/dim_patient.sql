WITH hub AS (
    SELECT
        PATIENT_HK,
        PATIENT_ID,
        LOAD_DATETIME AS HUB_LOAD_DATETIME
    FROM {{ ref('hub_patient') }}
),

sat_latest AS (
    SELECT
        PATIENT_HK,
        FIRST_NAME,
        LAST_NAME,
        DATE_OF_BIRTH,
        GENDER,
        ADDRESS,
        PHONE,
        LOAD_DATETIME AS SAT_LOAD_DATETIME,
        ROW_NUMBER() OVER (
            PARTITION BY PATIENT_HK
            ORDER BY LOAD_DATETIME DESC
        ) AS rn
    FROM {{ ref('sat_patient_details') }}
),

visit_summary AS (
    SELECT
        PATIENT_HK,
        TOTAL_VISITS,
        DISTINCT_DOCTORS,
        TOTAL_TREATMENT_COST,
        FIRST_VISIT_DATE,
        LAST_VISIT_DATE,
        DISTINCT_MEDICATIONS
    FROM {{ ref('sat_patient_visit_summary') }}
)

SELECT
    h.PATIENT_HK,
    h.PATIENT_ID,
    s.FIRST_NAME,
    s.LAST_NAME,
    s.FIRST_NAME || ' ' || s.LAST_NAME AS FULL_NAME,
    s.DATE_OF_BIRTH,
    s.GENDER,
    s.ADDRESS,
    s.PHONE,
    COALESCE(vs.TOTAL_VISITS, 0) AS TOTAL_VISITS,
    COALESCE(vs.DISTINCT_DOCTORS, 0) AS DISTINCT_DOCTORS,
    COALESCE(vs.TOTAL_TREATMENT_COST, 0) AS TOTAL_TREATMENT_COST,
    vs.FIRST_VISIT_DATE,
    vs.LAST_VISIT_DATE,
    COALESCE(vs.DISTINCT_MEDICATIONS, 0) AS DISTINCT_MEDICATIONS,
    h.HUB_LOAD_DATETIME,
    s.SAT_LOAD_DATETIME
FROM hub h
INNER JOIN sat_latest s
    ON h.PATIENT_HK = s.PATIENT_HK
    AND s.rn = 1
LEFT JOIN visit_summary vs
    ON h.PATIENT_HK = vs.PATIENT_HK
