{%- set yaml_metadata -%}
source_model: "raw_patient_insurance"
derived_columns:
  RECORD_SOURCE: "RECORD_SOURCE"
  LOAD_DATETIME: "LOAD_DATE"
  EFFECTIVE_FROM: "START_DATE"
hashed_columns:
  PATIENT_HK: "PATIENT_ID"
  INSURANCE_HK: "INSURANCE_ID"
  LINK_PATIENT_INSURANCE_HK:
    - "PATIENT_ID"
    - "INSURANCE_ID"
  PATIENT_INSURANCE_HASHDIFF:
    is_hashdiff: true
    columns:
      - "POLICY_NUMBER"
      - "START_DATE"
      - "END_DATE"
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
