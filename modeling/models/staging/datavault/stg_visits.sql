{{ config(materialized='view') }}

{%- set yaml_metadata -%}
source_model:
  r2_seeds: 'raw_visits'
ldts: 'load_date'
rsrc: "!r2_lakehouse.seeds.raw_visits"
hashed_columns:
  hk_visit_h:
    - 'visit_id'
  hk_patient_h:
    - 'patient_id'
  hk_doctor_h:
    - 'doctor_id'
  hk_patient_doctor_l:
    - 'patient_id'
    - 'doctor_id'
  hk_visit_l:
    - 'visit_id'
    - 'patient_id'
    - 'doctor_id'
  hd_visit_s:
    is_hashdiff: true
    columns:
      - 'visit_date'
      - 'diagnosis_code'
      - 'diagnosis_name'
      - 'notes'
      - 'treatment_cost'
{%- endset -%}

{{ datavault4dbt.stage(yaml_metadata=yaml_metadata) }}
