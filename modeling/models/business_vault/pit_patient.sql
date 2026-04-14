{{ config(materialized='table') }}

-- Point-In-Time table for hub_patient.
-- Records, for every observed load timestamp, the latest
-- sat_patient_details.ldts as of that moment. This turns
-- temporal Sat lookups from an ORDER BY ... LIMIT 1 into a
-- simple equi-join.

WITH as_of_dates AS (
    SELECT {{ datavault4dbt.ldts_alias() }} AS as_of_date
    FROM {{ ref('hub_patient') }}

    UNION

    SELECT {{ datavault4dbt.ldts_alias() }} AS as_of_date
    FROM {{ ref('sat_patient_details') }}
),

hub AS (
    SELECT hk_patient_h
    FROM {{ ref('hub_patient') }}
),

hub_pit AS (
    SELECT
        hub.hk_patient_h,
        aod.as_of_date
    FROM hub
    CROSS JOIN as_of_dates aod
),

sat_patient_lookup AS (
    SELECT
        hp.hk_patient_h,
        hp.as_of_date,
        MAX(spd.{{ datavault4dbt.ldts_alias() }}) AS sat_patient_details_ldts
    FROM hub_pit hp
    LEFT JOIN {{ ref('sat_patient_details') }} spd
        ON hp.hk_patient_h = spd.hk_patient_h
        AND spd.{{ datavault4dbt.ldts_alias() }} <= hp.as_of_date
    GROUP BY hp.hk_patient_h, hp.as_of_date
)

SELECT
    spl.hk_patient_h,
    spl.as_of_date,
    spl.sat_patient_details_ldts
FROM sat_patient_lookup spl
WHERE spl.sat_patient_details_ldts IS NOT NULL
