{# Generates R2 location for external materialization based on target/env #}
{% macro r2_location(model_name) -%}
s3://dbt-warehouse/{{ var('dbt_env_prefix', 'dev') }}/marts/{{ model_name }}.parquet
{%- endmacro %}
