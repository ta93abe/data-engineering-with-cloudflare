with date_spine as (
    {{ dbt_utils.date_spine(
        datepart="day",
        start_date="cast('" ~ var('dim_dates_start_date', '2024-01-01') ~ "' as date)",
        end_date="cast('" ~ var('dim_dates_end_date', '2027-01-01') ~ "' as date)"
    ) }}
),

final as (
    select
        -- Primary Key
        date_day,

        -- Date Attributes
        extract(year from date_day) as year,
        extract(quarter from date_day) as quarter,
        extract(month from date_day) as month,
        weekofyear(date_day) as week_of_year,
        extract(day from date_day) as day_of_month,
        dayofweek(date_day) as day_of_week,

        -- Formatted Strings
        date_format(date_day, 'yyyy-MM') as year_month,
        date_format(date_day, 'yyyy') || '-Q' || extract(quarter from date_day) as year_quarter,
        date_format(date_day, 'MMMM') as month_name,
        date_format(date_day, 'EEEE') as day_name,

        -- Flags
        case when dayofweek(date_day) in (1, 7) then true else false end as is_weekend,
        case when dayofweek(date_day) between 2 and 6 then true else false end as is_weekday,

        -- Fiscal (assuming fiscal year = calendar year)
        extract(year from date_day) as fiscal_year,
        extract(quarter from date_day) as fiscal_quarter

    from date_spine
)

select * from final
