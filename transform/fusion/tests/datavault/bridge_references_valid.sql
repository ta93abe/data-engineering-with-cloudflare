-- Bridge テーブルの各 HK が対応するエンティティに存在することを検証する。
SELECT b.PATIENT_HK, 'hub_patient' AS missing_in
FROM {{ ref('bridge_patient_medication') }} b
LEFT JOIN {{ ref('hub_patient') }} hp ON b.PATIENT_HK = hp.PATIENT_HK
WHERE hp.PATIENT_HK IS NULL

UNION ALL

SELECT b.MEDICATION_HK, 'hub_medication' AS missing_in
FROM {{ ref('bridge_patient_medication') }} b
LEFT JOIN {{ ref('hub_medication') }} hm ON b.MEDICATION_HK = hm.MEDICATION_HK
WHERE hm.MEDICATION_HK IS NULL

UNION ALL

SELECT b.VISIT_HK, 'hub_visit' AS missing_in
FROM {{ ref('bridge_patient_medication') }} b
LEFT JOIN {{ ref('hub_visit') }} hv ON b.VISIT_HK = hv.VISIT_HK
WHERE hv.VISIT_HK IS NULL
