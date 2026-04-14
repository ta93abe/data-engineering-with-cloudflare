{{ config(materialized='incremental') }}

{%- set yaml_metadata -%}
parent_hashkey: 'hk_patient_h'
src_hashdiff: 'hd_patient_s'
src_payload:
  - 'first_name'
  - 'last_name'
  - 'date_of_birth'
  - 'gender'
  - 'address'
  - 'phone'
source_model: 'stg_patients'
{%- endset -%}

{{ datavault4dbt.sat_v0(yaml_metadata=yaml_metadata) }}
