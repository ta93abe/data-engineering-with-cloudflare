{{
    config(
        materialized='table',
        tags=['marts', 'dimension']
    )
}}

with date_spine as (
    select
        unnest(generate_series(
            date '2024-01-01',
            date '2024-12-31',
            interval '1 day'
        ))::date as date_day
),

final as (
    select
        -- Primary Key
        date_day,

        -- Date Attributes
        extract(year from date_day) as year,
        extract(quarter from date_day) as quarter,
        extract(month from date_day) as month,
        extract(week from date_day) as week_of_year,
        extract(day from date_day) as day_of_month,
        extract(dow from date_day) as day_of_week,

        -- Formatted Strings
        strftime(date_day, '%Y-%m') as year_month,
        strftime(date_day, '%Y-Q') || extract(quarter from date_day) as year_quarter,
        strftime(date_day, '%B') as month_name,
        strftime(date_day, '%A') as day_name,

        -- Flags
        case when extract(dow from date_day) in (0, 6) then true else false end as is_weekend,
        case when extract(dow from date_day) between 1 and 5 then true else false end as is_weekday,

        -- Fiscal (assuming fiscal year = calendar year)
        extract(year from date_day) as fiscal_year,
        extract(quarter from date_day) as fiscal_quarter

    from date_spine
)

select * from final
