{{ config(materialized='incremental') }}

{%- set yaml_metadata -%}
hashkey: 'hk_doctor_h'
business_keys:
  - 'doctor_id'
source_models:
  - name: stg_doctors
  - name: stg_visits
{%- endset -%}

{{ datavault4dbt.hub(yaml_metadata=yaml_metadata) }}
