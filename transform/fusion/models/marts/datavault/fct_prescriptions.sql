WITH prescription_link AS (
    SELECT
        LINK_PRESCRIPTION_HK,
        VISIT_HK,
        MEDICATION_HK,
        LOAD_DATETIME
    FROM {{ ref('link_prescription') }}
),

prescription_sat AS (
    SELECT
        LINK_PRESCRIPTION_HK,
        DOSAGE,
        FREQUENCY,
        CAST(DURATION_DAYS AS INT) AS DURATION_DAYS,
        LOAD_DATETIME,
        ROW_NUMBER() OVER (
            PARTITION BY LINK_PRESCRIPTION_HK
            ORDER BY LOAD_DATETIME DESC
        ) AS rn
    FROM {{ ref('sat_prescription_details') }}
),

bridge AS (
    SELECT
        PATIENT_HK,
        VISIT_HK,
        LINK_PRESCRIPTION_HK,
        MEDICATION_HK
    FROM {{ ref('bridge_patient_medication') }}
),

medication_sat AS (
    SELECT
        MEDICATION_HK,
        CAST(UNIT_PRICE AS DECIMAL(10, 2)) AS UNIT_PRICE,
        ROW_NUMBER() OVER (
            PARTITION BY MEDICATION_HK
            ORDER BY LOAD_DATETIME DESC
        ) AS rn
    FROM {{ ref('sat_medication_details') }}
),

visit_sat AS (
    SELECT
        VISIT_HK,
        EFFECTIVE_FROM AS VISIT_DATE,
        ROW_NUMBER() OVER (
            PARTITION BY VISIT_HK
            ORDER BY LOAD_DATETIME DESC
        ) AS rn
    FROM {{ ref('sat_visit_details') }}
)

SELECT
    pl.LINK_PRESCRIPTION_HK,
    b.PATIENT_HK,
    pl.VISIT_HK,
    pl.MEDICATION_HK,
    CAST(vs.VISIT_DATE AS DATE) AS PRESCRIPTION_DATE,
    ps.DOSAGE,
    ps.FREQUENCY,
    ps.DURATION_DAYS,
    ms.UNIT_PRICE,
    ps.DURATION_DAYS * ms.UNIT_PRICE AS ESTIMATED_COST
FROM prescription_link pl
INNER JOIN prescription_sat ps
    ON pl.LINK_PRESCRIPTION_HK = ps.LINK_PRESCRIPTION_HK
    AND ps.rn = 1
INNER JOIN bridge b
    ON pl.LINK_PRESCRIPTION_HK = b.LINK_PRESCRIPTION_HK
LEFT JOIN medication_sat ms
    ON pl.MEDICATION_HK = ms.MEDICATION_HK
    AND ms.rn = 1
LEFT JOIN visit_sat vs
    ON pl.VISIT_HK = vs.VISIT_HK
    AND vs.rn = 1
