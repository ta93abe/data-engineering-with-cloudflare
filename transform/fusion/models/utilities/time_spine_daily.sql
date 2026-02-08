{{
    config(
        materialized = 'table',
    )
}}

with

base_dates as (
    {{
        dbt.date_spine(
            'day',
            "DATE('2010-01-01')",
            "DATE('2030-01-01')"
        )
    }}
),

final as (
    select
        cast(date_day as date) as date_day
    from base_dates
)

select * from final
