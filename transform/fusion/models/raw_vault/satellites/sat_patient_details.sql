{%- set source_model = "stg_patients" -%}
{%- set src_pk = "PATIENT_HK" -%}
{%- set src_hashdiff = {"source_column": "PATIENT_HASHDIFF", "alias": "HASHDIFF"} -%}
{%- set src_payload = ["FIRST_NAME", "LAST_NAME", "DATE_OF_BIRTH", "GENDER", "ADDRESS", "PHONE"] -%}
{%- set src_eff = "EFFECTIVE_FROM" -%}
{%- set src_ldts = "LOAD_DATETIME" -%}
{%- set src_source = "RECORD_SOURCE" -%}

{{ automate_dv.sat(src_pk=src_pk, src_hashdiff=src_hashdiff,
                   src_payload=src_payload, src_eff=src_eff,
                   src_ldts=src_ldts, src_source=src_source,
                   source_model=source_model) }}
