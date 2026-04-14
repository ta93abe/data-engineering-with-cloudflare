{{ config(materialized='view') }}

{%- set yaml_metadata -%}
source_model:
  r2_seeds: 'raw_departments'
ldts: 'load_date'
rsrc: "!r2_lakehouse.seeds.raw_departments"
hashed_columns:
  hk_department_h:
    - 'department_id'
  hd_department_s:
    is_hashdiff: true
    columns:
      - 'department_name'
      - 'floor'
      - 'phone_extension'
{%- endset -%}

{{ datavault4dbt.stage(yaml_metadata=yaml_metadata) }}
