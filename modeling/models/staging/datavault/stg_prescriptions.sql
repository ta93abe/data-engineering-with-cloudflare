{{ config(materialized='view') }}

{%- set yaml_metadata -%}
source_model:
  r2_seeds: 'raw_prescriptions'
ldts: 'load_date'
rsrc: "!r2_lakehouse.seeds.raw_prescriptions"
hashed_columns:
  hk_prescription_h:
    - 'prescription_id'
  hk_visit_h:
    - 'visit_id'
  hk_medication_h:
    - 'medication_id'
  hk_prescription_l:
    - 'visit_id'
    - 'medication_id'
  hd_prescription_s:
    is_hashdiff: true
    columns:
      - 'dosage'
      - 'frequency'
      - 'duration_days'
{%- endset -%}

{{ datavault4dbt.stage(yaml_metadata=yaml_metadata) }}
