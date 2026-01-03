{{
    config(
        materialized='table',
        tags=['marts', 'dimension']
    )
}}

with repositories as (
    select * from {{ ref('stg_github__repositories') }}
),

latest_metrics as (
    select
        repository_full_name,
        max(stars_count) as current_stars,
        max(forks_count) as current_forks,
        max(open_issues_count) as current_open_issues,
        max(updated_at) as last_activity_at
    from repositories
    group by repository_full_name
),

repository_ages as (
    select
        repository_full_name,
        created_at,
        datediff('day', created_at, current_date) as age_in_days
    from repositories
),

final as (
    select
        r.repository_id,
        r.repository_full_name,
        r.repository_name,
        r.owner_login,
        r.owner_type,
        r.is_private,
        r.repository_description,
        r.repository_url,
        r.primary_language,
        r.default_branch,
        r.is_archived,
        r.is_disabled,

        -- Dates
        r.created_at,
        r.updated_at,
        r.pushed_at,
        m.last_activity_at,

        -- Current metrics
        m.current_stars,
        m.current_forks,
        m.current_open_issues,

        -- Calculated dimensions
        a.age_in_days,
        case
            when a.age_in_days < 30 then 'New'
            when a.age_in_days < 90 then 'Recent'
            when a.age_in_days < 365 then 'Established'
            else 'Mature'
        end as repository_age_category,

        case
            when m.current_stars >= 1000 then 'High'
            when m.current_stars >= 100 then 'Medium'
            when m.current_stars >= 10 then 'Low'
            else 'Minimal'
        end as star_popularity_tier,

        case when r.owner_type = 'Organization' then 1 else 0 end as is_organization_owned,

        current_timestamp as dimension_updated_at

    from repositories r
    left join latest_metrics m
        on r.repository_full_name = m.repository_full_name
    left join repository_ages a
        on r.repository_full_name = a.repository_full_name
)

select * from final
