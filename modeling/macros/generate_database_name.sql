{#
    Custom generate_database_name.

    Environment policy:
      * target.name == 'dev' (local development)
          -> always materialize into the personal database
             (target.database, typically USER$TA93ABE), regardless of
             any +database config declared in dbt_project.yml.
             This keeps a single sandbox per developer so `dbt run`
             locally never touches the shared production databases.

      * any other target (prod, ci, ...)
          -> honor custom_database_name from dbt_project.yml so each
             layer lands in its own database:
               staging / raw_vault / business_vault / marts
             Falls back to target.database when no +database is set.
#}
{% macro generate_database_name(custom_database_name=none, node=none) -%}
    {%- if target.name == 'dev' -%}
        {{ target.database }}
    {%- elif custom_database_name is none -%}
        {{ target.database }}
    {%- else -%}
        {{ custom_database_name | trim }}
    {%- endif -%}
{%- endmacro %}
