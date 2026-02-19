{{ config(meta={'is_auto_end_dating': true}) }}

{%- set source_model = "stg_patient_insurance" -%}
{%- set src_pk = "LINK_PATIENT_INSURANCE_HK" -%}
{%- set src_dfk = "PATIENT_HK" -%}
{%- set src_sfk = "INSURANCE_HK" -%}
{%- set src_start_date = "START_DATE" -%}
{%- set src_end_date = "END_DATE" -%}
{%- set src_eff = "EFFECTIVE_FROM" -%}
{%- set src_ldts = "LOAD_DATETIME" -%}
{%- set src_source = "RECORD_SOURCE" -%}

{{ automate_dv.eff_sat(src_pk=src_pk, src_dfk=src_dfk, src_sfk=src_sfk,
                       src_start_date=src_start_date,
                       src_end_date=src_end_date,
                       src_eff=src_eff, src_ldts=src_ldts,
                       src_source=src_source,
                       source_model=source_model) }}
