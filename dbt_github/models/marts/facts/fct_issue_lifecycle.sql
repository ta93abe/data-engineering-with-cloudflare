{{
    config(
        materialized='table',
        tags=['marts', 'fact']
    )
}}

with issues as (
    select * from {{ ref('stg_github__issues') }}
),

repositories as (
    select * from {{ ref('dim_repositories') }}
),

final as (
    select
        {{ dbt_utils.generate_surrogate_key(['i.issue_id', 'i.repository_full_name']) }} as issue_lifecycle_id,
        i.issue_id,
        r.repository_id,
        i.repository_full_name,

        -- Issue details
        i.issue_number,
        i.issue_title,
        i.issue_state,
        i.creator_login,
        i.labels,
        i.comments_count,

        -- Lifecycle dates
        i.created_at as issue_created_at,
        i.updated_at as issue_updated_at,
        i.closed_at as issue_closed_at,

        -- Lifecycle metrics
        i.days_to_close,
        i.is_open,
        i.is_closed,

        -- Derived metrics
        datediff('day', i.created_at, current_date) as days_since_creation,
        case
            when i.is_open = 1 then datediff('day', i.created_at, current_date)
            else i.days_to_close
        end as current_age_days,

        -- Categorization
        case
            when i.labels like '%bug%' then 1 else 0
        end as is_bug,
        case
            when i.labels like '%enhancement%' or i.labels like '%feature%' then 1 else 0
        end as is_enhancement,
        case
            when i.labels like '%documentation%' then 1 else 0
        end as is_documentation,

        case
            when i.days_to_close <= 1 then 'Same Day'
            when i.days_to_close <= 7 then 'Within Week'
            when i.days_to_close <= 30 then 'Within Month'
            when i.days_to_close is not null then 'Over Month'
            else 'Still Open'
        end as resolution_time_bucket,

        case
            when i.comments_count = 0 then 'No Discussion'
            when i.comments_count <= 5 then 'Low Discussion'
            when i.comments_count <= 15 then 'Medium Discussion'
            else 'High Discussion'
        end as discussion_level,

        current_timestamp as fact_updated_at

    from issues i
    left join repositories r
        on i.repository_full_name = r.repository_full_name
)

select * from final
