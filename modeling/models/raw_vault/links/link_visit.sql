{{ config(materialized='incremental') }}

{%- set yaml_metadata -%}
link_hashkey: 'hk_visit_l'
foreign_hashkeys:
  - 'hk_visit_h'
  - 'hk_patient_h'
  - 'hk_doctor_h'
source_models: stg_visits
{%- endset -%}

{{ datavault4dbt.link(yaml_metadata=yaml_metadata) }}
