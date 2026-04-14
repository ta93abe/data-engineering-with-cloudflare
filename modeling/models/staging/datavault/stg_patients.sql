{{ config(materialized='view') }}

{%- set yaml_metadata -%}
source_model:
  r2_seeds: 'raw_patients'
ldts: 'load_date'
rsrc: "!r2_lakehouse.seeds.raw_patients"
hashed_columns:
  hk_patient_h:
    - 'patient_id'
  hd_patient_s:
    is_hashdiff: true
    columns:
      - 'first_name'
      - 'last_name'
      - 'date_of_birth'
      - 'gender'
      - 'address'
      - 'phone'
{%- endset -%}

{{ datavault4dbt.stage(yaml_metadata=yaml_metadata) }}
