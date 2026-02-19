{{ config(materialized='table') }}

{#
  PIT (Point-In-Time) テーブル: pit_patient

  目的:
    hub_patient に紐づく複数の Satellite について、
    各時点（as_of_date）での「最新レコード」の LOAD_DATETIME を保持する。
    これにより、任意の時点での患者の状態を効率的にクエリできる。

  構造:
    PATIENT_HK | AS_OF_DATE | SAT_PATIENT_DETAILS_LDTS | SAT_PATIENT_DETAILS_PK
#}

WITH as_of_dates AS (
    -- Raw Vault 内の全 LOAD_DATETIME を収集して、PITの時間軸を作る
    SELECT DISTINCT LOAD_DATETIME AS AS_OF_DATE
    FROM {{ ref('hub_patient') }}

    UNION

    SELECT DISTINCT LOAD_DATETIME AS AS_OF_DATE
    FROM {{ ref('sat_patient_details') }}
),

hub AS (
    SELECT PATIENT_HK
    FROM {{ ref('hub_patient') }}
),

-- Hub × as_of_date の全組み合わせ
hub_pit AS (
    SELECT
        hub.PATIENT_HK,
        aod.AS_OF_DATE
    FROM hub
    CROSS JOIN as_of_dates aod
),

-- 各時点での sat_patient_details の最新 LOAD_DATETIME を特定
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
    COALESCE(spl.SAT_PATIENT_DETAILS_LDTS, CAST('1900-01-01' AS TIMESTAMP)) AS SAT_PATIENT_DETAILS_LDTS
FROM sat_patient_lookup spl
WHERE spl.SAT_PATIENT_DETAILS_LDTS IS NOT NULL
ORDER BY spl.PATIENT_HK, spl.AS_OF_DATE
