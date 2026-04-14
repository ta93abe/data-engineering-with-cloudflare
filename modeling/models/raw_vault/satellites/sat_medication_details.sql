{{ config(materialized='incremental') }}

{%- set yaml_metadata -%}
parent_hashkey: 'hk_medication_h'
src_hashdiff: 'hd_medication_s'
src_payload:
  - 'medication_name'
  - 'type'
  - 'manufacturer'
  - 'unit_price'
source_model: 'stg_medications'
{%- endset -%}

{{ datavault4dbt.sat_v0(yaml_metadata=yaml_metadata) }}
