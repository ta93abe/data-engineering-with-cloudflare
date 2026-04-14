{{ config(materialized='incremental') }}

{%- set yaml_metadata -%}
hashkey: 'hk_patient_h'
business_keys:
  - 'patient_id'
source_models:
  - stg_patients
  - stg_visits
  - stg_patient_insurance
{%- endset -%}

{{ datavault4dbt.hub(yaml_metadata=yaml_metadata) }}
