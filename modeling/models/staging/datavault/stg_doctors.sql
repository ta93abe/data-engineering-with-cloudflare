{{ config(materialized='view') }}

{%- set yaml_metadata -%}
source_model:
  r2_seeds: 'raw_doctors'
ldts: 'load_date'
rsrc: "!r2_lakehouse.seeds.raw_doctors"
hashed_columns:
  hk_doctor_h:
    - 'doctor_id'
  hd_doctor_s:
    is_hashdiff: true
    columns:
      - 'first_name'
      - 'last_name'
      - 'specialty'
      - 'license_number'
{%- endset -%}

{{ datavault4dbt.stage(yaml_metadata=yaml_metadata) }}
