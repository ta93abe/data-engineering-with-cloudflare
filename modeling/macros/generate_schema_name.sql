{#
    Custom generate_schema_name.

    Unlike dbt's default (which prepends target.schema in dev to avoid
    collisions between developers sharing a database), this project
    always uses the custom_schema_name as-is. Layer-specific schemas
    (hub / satellite / link / dimension / fact / ...) are declared in
    dbt_project.yml and should materialize identically in dev and prod.

    Developer isolation is handled by generate_database_name() which
    already redirects everything to USER$TA93ABE locally.
#}
{% macro generate_schema_name(custom_schema_name, node) -%}
    {%- if custom_schema_name is none -%}
        {{ target.schema }}
    {%- else -%}
        {{ custom_schema_name | trim }}
    {%- endif -%}
{%- endmacro %}
