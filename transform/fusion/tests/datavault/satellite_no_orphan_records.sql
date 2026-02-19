-- Satellite レコードが対応する Hub/Link を持つことを検証する。
-- 孤立した Satellite レコードがあればテスト失敗。
SELECT spd.PATIENT_HK, 'sat_patient_details' AS satellite_name
FROM {{ ref('sat_patient_details') }} spd
LEFT JOIN {{ ref('hub_patient') }} hp ON spd.PATIENT_HK = hp.PATIENT_HK
WHERE hp.PATIENT_HK IS NULL

UNION ALL

SELECT sdd.DOCTOR_HK, 'sat_doctor_details' AS satellite_name
FROM {{ ref('sat_doctor_details') }} sdd
LEFT JOIN {{ ref('hub_doctor') }} hd ON sdd.DOCTOR_HK = hd.DOCTOR_HK
WHERE hd.DOCTOR_HK IS NULL

UNION ALL

SELECT svd.VISIT_HK, 'sat_visit_details' AS satellite_name
FROM {{ ref('sat_visit_details') }} svd
LEFT JOIN {{ ref('hub_visit') }} hv ON svd.VISIT_HK = hv.VISIT_HK
WHERE hv.VISIT_HK IS NULL

UNION ALL

SELECT smd.MEDICATION_HK, 'sat_medication_details' AS satellite_name
FROM {{ ref('sat_medication_details') }} smd
LEFT JOIN {{ ref('hub_medication') }} hm ON smd.MEDICATION_HK = hm.MEDICATION_HK
WHERE hm.MEDICATION_HK IS NULL
