{{
    config(
        materialized = 'table',
    )
}}

with

base_dates as (
    {{
        dbt_utils.date_spine(
            datepart='day',
            start_date="cast('2010-01-01' as date)",
            end_date="cast('2030-01-01' as date)"
        )
    }}
),

final as (
    select
        cast(date_day as date) as date_day
    from base_dates
)

select * from final
