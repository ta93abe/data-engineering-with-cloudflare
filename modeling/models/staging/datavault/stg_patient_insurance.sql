{{ config(materialized='view') }}

{%- set yaml_metadata -%}
source_model:
  r2_seeds: 'raw_patient_insurance'
ldts: 'load_date'
rsrc: "!r2_lakehouse.seeds.raw_patient_insurance"
hashed_columns:
  hk_patient_h:
    - 'patient_id'
  hk_insurance_h:
    - 'insurance_id'
  hk_patient_insurance_l:
    - 'patient_id'
    - 'insurance_id'
  hd_patient_insurance_s:
    is_hashdiff: true
    columns:
      - 'policy_number'
      - 'start_date'
      - 'end_date'
{%- endset -%}

{{ datavault4dbt.stage(yaml_metadata=yaml_metadata) }}
