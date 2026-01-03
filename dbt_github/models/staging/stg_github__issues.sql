{{
    config(
        materialized='view',
        tags=['staging', 'issues']
    )
}}

with source as (
    select * from {{ source('github_raw', 'issues') }}
),

renamed as (
    select
        -- Primary key
        id as issue_id,

        -- Issue info
        number as issue_number,
        title as issue_title,
        state as issue_state,
        user_login as creator_login,
        labels,
        body as issue_body,

        -- Dates
        created_at::timestamp as created_at,
        updated_at::timestamp as updated_at,
        closed_at::timestamp as closed_at,

        -- Metrics
        comments as comments_count,

        -- Calculated fields
        case
            when closed_at is not null
            then datediff('day', created_at::timestamp, closed_at::timestamp)
        end as days_to_close,

        case when state = 'closed' then 1 else 0 end as is_closed,
        case when state = 'open' then 1 else 0 end as is_open,

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
        partition by issue_id
        order by extracted_at desc
    ) = 1
)

select * from deduped
