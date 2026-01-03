{{
    config(
        materialized='table',
        tags=['marts', 'fact']
    )
}}

with commits as (
    select * from {{ ref('stg_github__commits') }}
),

repositories as (
    select * from {{ ref('dim_repositories') }}
),

final as (
    select
        {{ dbt_utils.generate_surrogate_key(['c.commit_sha', 'c.repository_full_name']) }} as commit_stats_id,
        c.commit_sha,
        r.repository_id,
        c.repository_full_name,

        -- Commit details
        c.commit_message,
        c.author_name,
        c.author_email,
        c.committer_name,
        c.committer_email,
        c.is_self_committed,
        c.is_merge_commit,

        -- Dates
        c.author_date,
        c.committer_date,

        -- Message analysis
        c.message_length,
        case
            when c.message_length < 50 then 'Short'
            when c.message_length < 150 then 'Medium'
            else 'Detailed'
        end as message_detail_level,

        -- Commit type categorization
        case
            when lower(c.commit_message) like 'fix%' or lower(c.commit_message) like '%fix:%' then 1
            else 0
        end as is_fix_commit,

        case
            when lower(c.commit_message) like 'feat%' or lower(c.commit_message) like '%feat:%' then 1
            else 0
        end as is_feature_commit,

        case
            when lower(c.commit_message) like 'docs%' or lower(c.commit_message) like '%docs:%' then 1
            else 0
        end as is_docs_commit,

        case
            when lower(c.commit_message) like 'test%' or lower(c.commit_message) like '%test:%' then 1
            else 0
        end as is_test_commit,

        case
            when lower(c.commit_message) like 'refactor%' or lower(c.commit_message) like '%refactor:%' then 1
            else 0
        end as is_refactor_commit,

        -- Time analysis
        extract(hour from c.author_date) as commit_hour_of_day,
        extract(dow from c.author_date) as commit_day_of_week,
        case
            when extract(dow from c.author_date) in (0, 6) then 1
            else 0
        end as is_weekend_commit,

        case
            when extract(hour from c.author_date) between 9 and 17 then 'Business Hours'
            when extract(hour from c.author_date) between 18 and 23 then 'Evening'
            else 'Night/Early Morning'
        end as commit_time_category,

        -- Time between author and committer (for rebases, cherry-picks, etc.)
        datediff('second', c.author_date, c.committer_date) as author_to_committer_delay_seconds,

        current_timestamp as fact_updated_at

    from commits c
    left join repositories r
        on c.repository_full_name = r.repository_full_name
)

select * from final
