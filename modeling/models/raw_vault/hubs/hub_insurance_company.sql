{{ config(materialized='incremental') }}

{%- set yaml_metadata -%}
hashkey: 'hk_insurance_h'
business_keys:
  - 'insurance_id'
source_models:
  - name: stg_insurance_companies
  - name: stg_patient_insurance
{%- endset -%}

{{ datavault4dbt.hub(yaml_metadata=yaml_metadata) }}
