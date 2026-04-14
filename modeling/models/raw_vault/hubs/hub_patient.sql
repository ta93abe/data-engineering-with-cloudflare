{{ config(materialized='incremental') }}

{%- set yaml_metadata -%}
hashkey: 'hk_patient_h'
business_keys:
  - 'patient_id'
source_models:
  - name: stg_patients
  - name: stg_visits
  - name: stg_patient_insurance
{%- endset -%}

{{ datavault4dbt.hub(yaml_metadata=yaml_metadata) }}
