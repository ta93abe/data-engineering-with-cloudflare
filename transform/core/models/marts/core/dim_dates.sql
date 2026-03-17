{{ config(location='s3://data-lake/dbt/marts/dim_dates.parquet') }}
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
        extract(week from date_day) as week_of_year,
        extract(day from date_day) as day_of_month,
        extract(dow from date_day) as day_of_week,

        -- Formatted Strings
        {% if target.type == 'snowflake' %}
        to_char(date_day, 'YYYY-MM') as year_month,
        to_char(date_day, 'YYYY') || '-Q' || to_char(date_day, 'Q') as year_quarter,
        to_char(date_day, 'MMMM') as month_name,
        to_char(date_day, 'DAY') as day_name,
        {% elif target.type == 'duckdb' %}
        strftime(date_day, '%Y-%m') as year_month,
        strftime(date_day, '%Y-Q') || extract(quarter from date_day) as year_quarter,
        strftime(date_day, '%B') as month_name,
        strftime(date_day, '%A') as day_name,
        {% else %}
        {{ exceptions.raise_compiler_error("Unsupported target type for dim_dates: " ~ target.type) }}
        {% endif %}

        -- Flags
        case when extract(dow from date_day) in (0, 6) then true else false end as is_weekend,
        case when extract(dow from date_day) between 1 and 5 then true else false end as is_weekday,

        -- Fiscal (assuming fiscal year = calendar year)
        extract(year from date_day) as fiscal_year,
        extract(quarter from date_day) as fiscal_quarter

    from date_spine
)

select * from final
