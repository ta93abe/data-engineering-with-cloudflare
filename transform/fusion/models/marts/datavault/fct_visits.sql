{{ config(materialized='table') }}

{#
  Fact: fct_visits
  診察のファクトテーブル。

  Link（関係）+ Satellite（属性）を結合して、
  ディメンションキーとメジャー（計測値）を持つファクトテーブルを作成する。

  粒度: 1診察 = 1行
#}

WITH visit_link AS (
    SELECT
        LINK_VISIT_HK,
        PATIENT_HK,
        DOCTOR_HK,
        VISIT_HK,
        LOAD_DATETIME
    FROM {{ ref('link_visit') }}
),

visit_sat AS (
    SELECT
        VISIT_HK,
        DIAGNOSIS_CODE,
        DIAGNOSIS_NAME,
        NOTES,
        CAST(TREATMENT_COST AS DECIMAL(10, 2)) AS TREATMENT_COST,
        EFFECTIVE_FROM AS VISIT_DATE,
        LOAD_DATETIME,
        ROW_NUMBER() OVER (
            PARTITION BY VISIT_HK
            ORDER BY LOAD_DATETIME DESC
        ) AS rn
    FROM {{ ref('sat_visit_details') }}
),

visit_hub AS (
    SELECT
        VISIT_HK,
        VISIT_ID
    FROM {{ ref('hub_visit') }}
)

SELECT
    vl.LINK_VISIT_HK,
    vh.VISIT_ID,
    vl.PATIENT_HK,
    vl.DOCTOR_HK,
    CAST(vs.VISIT_DATE AS DATE) AS VISIT_DATE,
    vs.DIAGNOSIS_CODE,
    vs.DIAGNOSIS_NAME,
    vs.NOTES,
    vs.TREATMENT_COST
FROM visit_link vl
INNER JOIN visit_sat vs
    ON vl.VISIT_HK = vs.VISIT_HK
    AND vs.rn = 1
INNER JOIN visit_hub vh
    ON vl.VISIT_HK = vh.VISIT_HK
