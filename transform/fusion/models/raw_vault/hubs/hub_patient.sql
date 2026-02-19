{{ config(materialized='incremental') }}

{%- set source_model = "stg_patients" -%}
{%- set src_pk = "PATIENT_HK" -%}
{%- set src_nk = "PATIENT_ID" -%}
{%- set src_ldts = "LOAD_DATETIME" -%}
{%- set src_source = "RECORD_SOURCE" -%}

{{ automate_dv.hub(src_pk=src_pk, src_nk=src_nk, src_ldts=src_ldts,
                   src_source=src_source, source_model=source_model) }}
