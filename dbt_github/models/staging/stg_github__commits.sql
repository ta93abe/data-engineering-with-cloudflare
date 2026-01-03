{{
    config(
        materialized='view',
        tags=['staging', 'commits']
    )
}}

with source as (
    select * from {{ source('github_raw', 'commits') }}
),

renamed as (
    select
        -- Primary key
        sha as commit_sha,

        -- Commit info
        commit_message,
        author_name,
        author_email,
        committer_name,
        committer_email,

        -- Dates
        author_date::timestamp as author_date,
        committer_date::timestamp as committer_date,

        -- Calculated fields
        case when author_email = committer_email then 1 else 0 end as is_self_committed,
        length(commit_message) as message_length,
        case
            when lower(commit_message) like '%merge%' then 1
            else 0
        end as is_merge_commit,

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
        partition by commit_sha
        order by extracted_at desc
    ) = 1
)

select * from deduped
