{{ config(materialized='view') }}

{%- set yaml_metadata -%}
source_model:
  r2_seeds: 'raw_medications'
ldts: 'load_date'
rsrc: "!r2_lakehouse.seeds.raw_medications"
hashed_columns:
  hk_medication_h:
    - 'medication_id'
  hd_medication_s:
    is_hashdiff: true
    columns:
      - 'medication_name'
      - 'type'
      - 'manufacturer'
      - 'unit_price'
{%- endset -%}

{{ datavault4dbt.stage(yaml_metadata=yaml_metadata) }}
