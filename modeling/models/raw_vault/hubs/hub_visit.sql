{{ config(materialized='incremental') }}

{%- set yaml_metadata -%}
hashkey: 'hk_visit_h'
business_keys:
  - 'visit_id'
source_models:
  - stg_visits
  - stg_prescriptions
{%- endset -%}

{{ datavault4dbt.hub(yaml_metadata=yaml_metadata) }}
