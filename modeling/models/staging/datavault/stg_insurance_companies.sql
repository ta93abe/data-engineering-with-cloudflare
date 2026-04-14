{{ config(materialized='view') }}

{%- set yaml_metadata -%}
source_model:
  r2_seeds: 'raw_insurance_companies'
ldts: 'load_date'
rsrc: "!r2_lakehouse.seeds.raw_insurance_companies"
hashed_columns:
  hk_insurance_h:
    - 'insurance_id'
  hd_insurance_s:
    is_hashdiff: true
    columns:
      - 'company_name'
      - 'plan_type'
{%- endset -%}

{{ datavault4dbt.stage(yaml_metadata=yaml_metadata) }}
