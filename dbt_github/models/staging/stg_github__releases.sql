{{
    config(
        materialized='view',
        tags=['staging', 'releases']
    )
}}

with source as (
    select * from {{ source('github_raw', 'releases') }}
),

renamed as (
    select
        -- Primary key
        id as release_id,

        -- Release info
        tag_name,
        name as release_name,
        draft as is_draft,
        prerelease as is_prerelease,
        author_login,
        body as release_notes,

        -- Dates
        created_at::timestamp as created_at,
        published_at::timestamp as published_at,

        -- Calculated fields
        case
            when is_draft = false and is_prerelease = false then 1
            else 0
        end as is_stable_release,

        length(body) as release_notes_length,

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
        partition by release_id
        order by extracted_at desc
    ) = 1
)

select * from deduped
