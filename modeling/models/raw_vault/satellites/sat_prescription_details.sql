{{ config(materialized='incremental') }}

{%- set yaml_metadata -%}
parent_hashkey: 'hk_prescription_l'
src_hashdiff: 'hd_prescription_s'
src_payload:
  - 'prescription_id'
  - 'dosage'
  - 'frequency'
  - 'duration_days'
source_model: 'stg_prescriptions'
{%- endset -%}

{{ datavault4dbt.sat_v0(yaml_metadata=yaml_metadata) }}
