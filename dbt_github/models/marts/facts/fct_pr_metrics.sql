{{
    config(
        materialized='table',
        tags=['marts', 'fact']
    )
}}

with pull_requests as (
    select * from {{ ref('stg_github__pull_requests') }}
),

repositories as (
    select * from {{ ref('dim_repositories') }}
),

final as (
    select
        {{ dbt_utils.generate_surrogate_key(['pr.pull_request_id', 'pr.repository_full_name']) }} as pr_metrics_id,
        pr.pull_request_id,
        r.repository_id,
        pr.repository_full_name,

        -- PR details
        pr.pr_number,
        pr.pr_title,
        pr.pr_state,
        pr.creator_login,
        pr.is_draft,
        pr.is_merged,
        pr.is_open,

        -- Dates
        pr.created_at as pr_created_at,
        pr.updated_at as pr_updated_at,
        pr.closed_at as pr_closed_at,
        pr.merged_at as pr_merged_at,

        -- Code change metrics
        pr.commits_count,
        pr.additions_count,
        pr.deletions_count,
        pr.changed_files_count,
        pr.total_changes,

        -- Review metrics
        pr.comments_count,
        pr.review_comments_count,
        pr.comments_count + pr.review_comments_count as total_comment_activity,

        -- Time metrics
        pr.hours_to_merge,
        datediff('day', pr.created_at, current_date) as days_since_creation,

        -- Categorization
        case
            when pr.total_changes < 50 then 'XS'
            when pr.total_changes < 200 then 'S'
            when pr.total_changes < 500 then 'M'
            when pr.total_changes < 1000 then 'L'
            else 'XL'
        end as pr_size_category,

        case
            when pr.changed_files_count <= 2 then 'Focused'
            when pr.changed_files_count <= 10 then 'Moderate'
            else 'Wide-Reaching'
        end as scope_category,

        case
            when pr.hours_to_merge < 24 then 'Fast'
            when pr.hours_to_merge < 168 then 'Normal'  -- 7 days
            when pr.hours_to_merge is not null then 'Slow'
            else 'Not Merged'
        end as merge_speed_category,

        case
            when pr.review_comments_count = 0 then 'No Review'
            when pr.review_comments_count <= 5 then 'Light Review'
            when pr.review_comments_count <= 15 then 'Moderate Review'
            else 'Heavy Review'
        end as review_intensity,

        -- Efficiency score (fewer changes, faster merge = better)
        case
            when pr.is_merged = 1 and pr.hours_to_merge is not null
            then round(1000.0 / (pr.hours_to_merge + 1), 2)
            else null
        end as merge_efficiency_score,

        current_timestamp as fact_updated_at

    from pull_requests pr
    left join repositories r
        on pr.repository_full_name = r.repository_full_name
)

select * from final
