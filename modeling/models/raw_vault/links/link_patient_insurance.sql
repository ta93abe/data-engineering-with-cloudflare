{{ config(materialized='incremental') }}

{%- set yaml_metadata -%}
link_hashkey: 'hk_patient_insurance_l'
foreign_hashkeys:
  - 'hk_patient_h'
  - 'hk_insurance_h'
source_models: stg_patient_insurance
{%- endset -%}

{{ datavault4dbt.link(yaml_metadata=yaml_metadata) }}
