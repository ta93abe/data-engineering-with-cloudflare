{{
    config(
        materialized='view',
        tags=['staging', 'workflow_runs']
    )
}}

with source as (
    select * from {{ source('github_raw', 'workflow_runs') }}
),

renamed as (
    select
        -- Primary key
        id as workflow_run_id,

        -- Workflow info
        name as workflow_name,
        head_branch,
        head_sha,
        status as workflow_status,
        conclusion as workflow_conclusion,
        run_attempt,

        -- Dates
        created_at::timestamp as created_at,
        updated_at::timestamp as updated_at,
        run_started_at::timestamp as run_started_at,

        -- Calculated fields
        case when status = 'completed' then 1 else 0 end as is_completed,
        case when conclusion = 'success' then 1 else 0 end as is_success,
        case when conclusion = 'failure' then 1 else 0 end as is_failure,
        case when run_attempt > 1 then 1 else 0 end as is_retry,

        case
            when status = 'completed'
            then datediff('second', run_started_at::timestamp, updated_at::timestamp)
        end as duration_seconds,

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
        partition by workflow_run_id
        order by extracted_at desc
    ) = 1
)

select * from deduped
