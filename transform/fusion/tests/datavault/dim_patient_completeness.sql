-- Hub に登録されたすべての患者が dim_patient に含まれることを検証する。
-- Hub にいるが dim にいない患者がいればテスト失敗。
SELECT hp.PATIENT_HK, hp.PATIENT_ID
FROM {{ ref('hub_patient') }} hp
LEFT JOIN {{ ref('dim_patient') }} dp ON hp.PATIENT_HK = dp.PATIENT_HK
WHERE dp.PATIENT_HK IS NULL
