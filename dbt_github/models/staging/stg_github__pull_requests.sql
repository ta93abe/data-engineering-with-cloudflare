{{
    config(
        materialized='view',
        tags=['staging', 'pull_requests']
    )
}}

with source as (
    select * from {{ source('github_raw', 'pull_requests') }}
),

renamed as (
    select
        -- Primary key
        id as pull_request_id,

        -- PR info
        number as pr_number,
        title as pr_title,
        state as pr_state,
        user_login as creator_login,
        merge_commit_sha,
        draft as is_draft,

        -- Dates
        created_at::timestamp as created_at,
        updated_at::timestamp as updated_at,
        closed_at::timestamp as closed_at,
        merged_at::timestamp as merged_at,

        -- Metrics
        comments as comments_count,
        review_comments as review_comments_count,
        commits as commits_count,
        additions as additions_count,
        deletions as deletions_count,
        changed_files as changed_files_count,

        -- Calculated fields
        case when merged_at is not null then 1 else 0 end as is_merged,
        case when state = 'closed' and merged_at is null then 1 else 0 end as is_closed_unmerged,
        case when state = 'open' then 1 else 0 end as is_open,

        case
            when merged_at is not null
            then datediff('hour', created_at::timestamp, merged_at::timestamp)
        end as hours_to_merge,

        additions_count + deletions_count as total_changes,

        -- Metadata
        _extracted_at::timestamp as extracted_at,
        _execution_id as execution_id,
        _repository_full_name as repository_full_name

    from source
),

deduped as (
    select *
    from renamed
    qualify row_number() over (
        partition by pull_request_id
        order by extracted_at desc
    ) = 1
)

select * from deduped
