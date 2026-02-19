{%- set source_model = "stg_visits" -%}
{%- set src_pk = "VISIT_HK" -%}
{%- set src_hashdiff = {"source_column": "VISIT_HASHDIFF", "alias": "HASHDIFF"} -%}
{%- set src_payload = ["DIAGNOSIS_CODE", "DIAGNOSIS_NAME", "NOTES", "TREATMENT_COST"] -%}
{%- set src_eff = "EFFECTIVE_FROM" -%}
{%- set src_ldts = "LOAD_DATETIME" -%}
{%- set src_source = "RECORD_SOURCE" -%}

{{ automate_dv.sat(src_pk=src_pk, src_hashdiff=src_hashdiff,
                   src_payload=src_payload, src_eff=src_eff,
                   src_ldts=src_ldts, src_source=src_source,
                   source_model=source_model) }}
