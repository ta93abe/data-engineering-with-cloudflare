{# Generates R2 location for external materialization based on target/env #}
{% macro r2_location(model_name) %}
  {%- if target.name == 'ci' -%}
    s3://dbt-warehouse/{{ var('dbt_env_prefix', 'dev') }}/marts/{{ model_name }}.parquet
  {%- elif target.name == 'dev' -%}
    s3://dbt-warehouse/dev/marts/{{ model_name }}.parquet
  {%- else -%}
    s3://dbt-warehouse/prod/marts/{{ model_name }}.parquet
  {%- endif -%}
{% endmacro %}
