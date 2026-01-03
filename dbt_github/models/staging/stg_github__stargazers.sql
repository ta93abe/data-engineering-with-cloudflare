{{
    config(
        materialized='view',
        tags=['staging', 'stargazers']
    )
}}

with source as (
    select * from {{ source('github_raw', 'stargazers') }}
),

renamed as (
    select
        -- Composite key (user + repository)
        user_login,
        user_id,

        -- Event info
        starred_at::timestamp as starred_at,

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
        partition by user_login, repository_full_name
        order by extracted_at desc
    ) = 1
)

select * from deduped
