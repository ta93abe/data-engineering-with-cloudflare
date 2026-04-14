{{ config(materialized='table') }}

-- Prescription fact table. Combines the prescription link and
-- its details satellite, the bridge for patient discovery, and
-- the medication/visit sats to compute an estimated cost.

WITH prescription_link AS (
    SELECT
        hk_prescription_l,
        hk_visit_h,
        hk_medication_h,
        ldts AS link_ldts
    FROM {{ ref('link_prescription') }}
),

prescription_sat AS (
    SELECT
        hk_prescription_l,
        prescription_id,
        dosage,
        frequency,
        CAST(duration_days AS INT) AS duration_days,
        ROW_NUMBER() OVER (
            PARTITION BY hk_prescription_l
            ORDER BY ldts DESC
        ) AS rn
    FROM {{ ref('sat_prescription_details') }}
),

bridge AS (
    SELECT
        hk_patient_h,
        hk_visit_h,
        hk_prescription_l,
        hk_medication_h
    FROM {{ ref('bridge_patient_medication') }}
),

medication_sat AS (
    SELECT
        hk_medication_h,
        CAST(unit_price AS DECIMAL(10, 2)) AS unit_price,
        ROW_NUMBER() OVER (
            PARTITION BY hk_medication_h
            ORDER BY ldts DESC
        ) AS rn
    FROM {{ ref('sat_medication_details') }}
),

visit_sat AS (
    SELECT
        hk_visit_h,
        visit_date,
        ROW_NUMBER() OVER (
            PARTITION BY hk_visit_h
            ORDER BY ldts DESC
        ) AS rn
    FROM {{ ref('sat_visit_details') }}
)

SELECT
    pl.hk_prescription_l,
    ps.prescription_id,
    b.hk_patient_h,
    pl.hk_visit_h,
    pl.hk_medication_h,
    CAST(vs.visit_date AS DATE) AS prescription_date,
    ps.dosage,
    ps.frequency,
    ps.duration_days,
    ms.unit_price,
    ps.duration_days * ms.unit_price AS estimated_cost
FROM prescription_link pl
INNER JOIN prescription_sat ps
    ON pl.hk_prescription_l = ps.hk_prescription_l
    AND ps.rn = 1
INNER JOIN bridge b
    ON pl.hk_prescription_l = b.hk_prescription_l
INNER JOIN medication_sat ms
    ON pl.hk_medication_h = ms.hk_medication_h
    AND ms.rn = 1
INNER JOIN visit_sat vs
    ON pl.hk_visit_h = vs.hk_visit_h
    AND vs.rn = 1
