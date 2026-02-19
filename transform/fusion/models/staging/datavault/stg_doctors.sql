{%- set yaml_metadata -%}
source_model: "raw_doctors"
derived_columns:
  RECORD_SOURCE: "RECORD_SOURCE"
  LOAD_DATETIME: "LOAD_DATE"
  EFFECTIVE_FROM: "LOAD_DATE"
hashed_columns:
  DOCTOR_HK: "DOCTOR_ID"
  DOCTOR_HASHDIFF:
    is_hashdiff: true
    columns:
      - "FIRST_NAME"
      - "LAST_NAME"
      - "SPECIALTY"
      - "LICENSE_NUMBER"
{%- endset -%}

{% set metadata_dict = fromyaml(yaml_metadata) %}

{% set source_model = metadata_dict["source_model"] %}
{% set derived_columns = metadata_dict["derived_columns"] %}
{% set hashed_columns = metadata_dict["hashed_columns"] %}

{{ automate_dv.stage(include_source_columns=true,
                     source_model=source_model,
                     derived_columns=derived_columns,
                     null_columns=none,
                     hashed_columns=hashed_columns,
                     ranked_columns=none) }}
