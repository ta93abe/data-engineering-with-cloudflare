-- link_visit の FK がすべて対応する Hub に存在することを検証する。
-- 行が返ればテスト失敗（孤立した FK がある）。
SELECT lv.LINK_VISIT_HK, 'PATIENT_HK' AS missing_in
FROM {{ ref('link_visit') }} lv
LEFT JOIN {{ ref('hub_patient') }} hp ON lv.PATIENT_HK = hp.PATIENT_HK
WHERE hp.PATIENT_HK IS NULL

UNION ALL

SELECT lv.LINK_VISIT_HK, 'DOCTOR_HK' AS missing_in
FROM {{ ref('link_visit') }} lv
LEFT JOIN {{ ref('hub_doctor') }} hd ON lv.DOCTOR_HK = hd.DOCTOR_HK
WHERE hd.DOCTOR_HK IS NULL

UNION ALL

SELECT lv.LINK_VISIT_HK, 'VISIT_HK' AS missing_in
FROM {{ ref('link_visit') }} lv
LEFT JOIN {{ ref('hub_visit') }} hv ON lv.VISIT_HK = hv.VISIT_HK
WHERE hv.VISIT_HK IS NULL
