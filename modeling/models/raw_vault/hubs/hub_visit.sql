{{ config(materialized='incremental') }}

{%- set yaml_metadata -%}
hashkey: 'hk_visit_h'
business_keys:
  - 'visit_id'
source_models:
  - name: stg_visits
  - name: stg_prescriptions
{%- endset -%}

{{ datavault4dbt.hub(yaml_metadata=yaml_metadata) }}
