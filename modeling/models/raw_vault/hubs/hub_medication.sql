{{ config(materialized='incremental') }}

{%- set yaml_metadata -%}
hashkey: 'hk_medication_h'
business_keys:
  - 'medication_id'
source_models:
  - name: stg_medications
  - name: stg_prescriptions
{%- endset -%}

{{ datavault4dbt.hub(yaml_metadata=yaml_metadata) }}
