{{ config(materialized='table') }}

{#
  Bridge テーブル: bridge_patient_medication

  目的:
    hub_patient から hub_medication までの多段 JOIN パスを事前結合する。
    通常のクエリでは patient → link_visit → link_prescription → medication と
    4テーブルの JOIN が必要だが、Bridge があれば1テーブルで済む。

  パス:
    hub_patient → link_visit → hub_visit → link_prescription → hub_medication
#}

WITH patient_visits AS (
    -- 患者と診察の関係（link_visit から）
    SELECT
        lv.LINK_VISIT_HK,
        lv.PATIENT_HK,
        lv.VISIT_HK
    FROM {{ ref('link_visit') }} lv
),

visit_prescriptions AS (
    -- 診察と処方の関係（link_prescription から）
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
