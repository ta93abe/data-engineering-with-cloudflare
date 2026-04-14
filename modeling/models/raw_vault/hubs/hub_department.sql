{{ config(materialized='incremental') }}

{%- set yaml_metadata -%}
hashkey: 'hk_department_h'
business_keys:
  - 'department_id'
source_models: stg_departments
{%- endset -%}

{{ datavault4dbt.hub(yaml_metadata=yaml_metadata) }}
