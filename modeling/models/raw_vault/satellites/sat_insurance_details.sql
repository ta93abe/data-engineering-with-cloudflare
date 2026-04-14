{{ config(materialized='incremental') }}

{%- set yaml_metadata -%}
parent_hashkey: 'hk_insurance_h'
src_hashdiff: 'hd_insurance_s'
src_payload:
  - 'company_name'
  - 'plan_type'
source_model: 'stg_insurance_companies'
{%- endset -%}

{{ datavault4dbt.sat_v0(yaml_metadata=yaml_metadata) }}
