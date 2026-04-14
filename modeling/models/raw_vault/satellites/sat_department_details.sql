{{ config(materialized='incremental') }}

{%- set yaml_metadata -%}
parent_hashkey: 'hk_department_h'
src_hashdiff: 'hd_department_s'
src_payload:
  - 'department_name'
  - 'floor'
  - 'phone_extension'
source_model: 'stg_departments'
{%- endset -%}

{{ datavault4dbt.sat_v0(yaml_metadata=yaml_metadata) }}
