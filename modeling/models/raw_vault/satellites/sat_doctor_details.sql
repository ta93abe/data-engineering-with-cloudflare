{{ config(materialized='incremental') }}

{%- set yaml_metadata -%}
parent_hashkey: 'hk_doctor_h'
src_hashdiff: 'hd_doctor_s'
src_payload:
  - 'first_name'
  - 'last_name'
  - 'specialty'
  - 'license_number'
source_model: 'stg_doctors'
{%- endset -%}

{{ datavault4dbt.sat_v0(yaml_metadata=yaml_metadata) }}
