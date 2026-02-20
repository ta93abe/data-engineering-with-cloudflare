WITH as_of_dates AS (
    SELECT LOAD_DATETIME AS AS_OF_DATE
    FROM {{ ref('hub_patient') }}

    UNION

    SELECT LOAD_DATETIME AS AS_OF_DATE
    FROM {{ ref('sat_patient_details') }}
),

hub AS (
    SELECT PATIENT_HK
    FROM {{ ref('hub_patient') }}
),

hub_pit AS (
    SELECT
        hub.PATIENT_HK,
        aod.AS_OF_DATE
    FROM hub
    CROSS JOIN as_of_dates aod
),

sat_patient_lookup AS (
    SELECT
        hp.PATIENT_HK,
        hp.AS_OF_DATE,
        MAX(spd.LOAD_DATETIME) AS SAT_PATIENT_DETAILS_LDTS
    FROM hub_pit hp
    LEFT JOIN {{ ref('sat_patient_details') }} spd
        ON hp.PATIENT_HK = spd.PATIENT_HK
        AND spd.LOAD_DATETIME <= hp.AS_OF_DATE
    GROUP BY hp.PATIENT_HK, hp.AS_OF_DATE
)

SELECT
    spl.PATIENT_HK,
    spl.AS_OF_DATE,
    spl.SAT_PATIENT_DETAILS_LDTS
FROM sat_patient_lookup spl
WHERE spl.SAT_PATIENT_DETAILS_LDTS IS NOT NULL
ORDER BY spl.PATIENT_HK, spl.AS_OF_DATE
