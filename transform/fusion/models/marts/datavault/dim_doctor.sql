WITH hub AS (
    SELECT
        DOCTOR_HK,
        DOCTOR_ID,
        LOAD_DATETIME AS HUB_LOAD_DATETIME
    FROM {{ ref('hub_doctor') }}
),

sat_latest AS (
    SELECT
        DOCTOR_HK,
        FIRST_NAME,
        LAST_NAME,
        SPECIALTY,
        LICENSE_NUMBER,
        LOAD_DATETIME AS SAT_LOAD_DATETIME,
        ROW_NUMBER() OVER (
            PARTITION BY DOCTOR_HK
            ORDER BY LOAD_DATETIME DESC
        ) AS rn
    FROM {{ ref('sat_doctor_details') }}
)

SELECT
    h.DOCTOR_HK,
    h.DOCTOR_ID,
    s.FIRST_NAME,
    s.LAST_NAME,
    s.FIRST_NAME || ' ' || s.LAST_NAME AS FULL_NAME,
    s.SPECIALTY,
    s.LICENSE_NUMBER,
    h.HUB_LOAD_DATETIME,
    s.SAT_LOAD_DATETIME
FROM hub h
INNER JOIN sat_latest s
    ON h.DOCTOR_HK = s.DOCTOR_HK
    AND s.rn = 1
