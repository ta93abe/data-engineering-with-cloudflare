{{ config(materialized='incremental') }}

{%- set yaml_metadata -%}
link_hashkey: 'hk_prescription_l'
foreign_hashkeys:
  - 'hk_visit_h'
  - 'hk_medication_h'
source_models: stg_prescriptions
{%- endset -%}

{{ datavault4dbt.link(yaml_metadata=yaml_metadata) }}
