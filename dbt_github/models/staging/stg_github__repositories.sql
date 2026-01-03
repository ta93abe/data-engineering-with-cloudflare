{{
    config(
        materialized='view',
        tags=['staging', 'repositories']
    )
}}

with source as (
    select * from {{ source('github_raw', 'repositories') }}
),

renamed as (
    select
        -- Primary key
        id as repository_id,

        -- Repository info
        full_name as repository_full_name,
        name as repository_name,
        owner_login,
        owner_type,
        private as is_private,
        description as repository_description,
        html_url as repository_url,

        -- Dates
        created_at::timestamp as created_at,
        updated_at::timestamp as updated_at,
        pushed_at::timestamp as pushed_at,

        -- Metrics
        size as repository_size_kb,
        stargazers_count as stars_count,
        watchers_count,
        forks_count,
        open_issues_count,

        -- Technical
        language as primary_language,
        default_branch,
        archived as is_archived,
        disabled as is_disabled,

        -- Metadata
        _extracted_at::timestamp as extracted_at,
        _execution_id as execution_id

    from source
),

deduped as (
    select *
    from renamed
    qualify row_number() over (
        partition by repository_id
        order by extracted_at desc
    ) = 1
)

select * from deduped
