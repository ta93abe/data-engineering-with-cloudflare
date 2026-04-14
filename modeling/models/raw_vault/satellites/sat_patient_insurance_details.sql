{{ config(materialized='incremental') }}

{%- set yaml_metadata -%}
parent_hashkey: 'hk_patient_insurance_l'
src_hashdiff: 'hd_patient_insurance_s'
src_payload:
  - 'policy_number'
  - 'start_date'
  - 'end_date'
source_model: 'stg_patient_insurance'
{%- endset -%}

{{ datavault4dbt.sat_v0(yaml_metadata=yaml_metadata) }}
