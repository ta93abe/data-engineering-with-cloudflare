{{ config(materialized='incremental') }}

{%- set yaml_metadata -%}
parent_hashkey: 'hk_visit_h'
src_hashdiff: 'hd_visit_s'
src_payload:
  - 'visit_date'
  - 'diagnosis_code'
  - 'diagnosis_name'
  - 'notes'
  - 'treatment_cost'
source_model: 'stg_visits'
{%- endset -%}

{{ datavault4dbt.sat_v0(yaml_metadata=yaml_metadata) }}
