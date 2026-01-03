{{
    config(
        materialized='incremental',
        unique_key='daily_metric_id',
        on_schema_change='append_new_columns',
        tags=['marts', 'aggregation', 'incremental']
    )
}}

with commits as (
    select * from {{ ref('stg_github__commits') }}
),

issues as (
    select * from {{ ref('stg_github__issues') }}
),

pull_requests as (
    select * from {{ ref('stg_github__pull_requests') }}
),

stargazers as (
    select * from {{ ref('stg_github__stargazers') }}
),

workflow_runs as (
    select * from {{ ref('stg_github__workflow_runs') }}
),

date_spine as (
    select distinct
        cast(author_date as date) as metric_date,
        repository_full_name
    from commits

    union

    select distinct
        cast(created_at as date) as metric_date,
        repository_full_name
    from issues

    union

    select distinct
        cast(created_at as date) as metric_date,
        repository_full_name
    from pull_requests
),

daily_commits as (
    select
        cast(author_date as date) as metric_date,
        repository_full_name,
        count(*) as commits_count,
        count(distinct author_email) as unique_committers
    from commits
    group by metric_date, repository_full_name
),

daily_issues as (
    select
        cast(created_at as date) as metric_date,
        repository_full_name,
        count(*) as issues_created,
        count(case when is_closed = 1 then issue_id end) as issues_closed
    from issues
    group by metric_date, repository_full_name
),

daily_prs as (
    select
        cast(created_at as date) as metric_date,
        repository_full_name,
        count(*) as prs_created,
        count(case when is_merged = 1 then pull_request_id end) as prs_merged
    from pull_requests
    group by metric_date, repository_full_name
),

daily_stars as (
    select
        cast(starred_at as date) as metric_date,
        repository_full_name,
        count(*) as stars_received
    from stargazers
    group by metric_date, repository_full_name
),

daily_workflows as (
    select
        cast(created_at as date) as metric_date,
        repository_full_name,
        count(*) as workflow_runs_total,
        count(case when is_success = 1 then workflow_run_id end) as workflow_runs_success,
        count(case when is_failure = 1 then workflow_run_id end) as workflow_runs_failure
    from workflow_runs
    group by metric_date, repository_full_name
),

final as (
    select
        {{ dbt_utils.generate_surrogate_key(['ds.metric_date', 'ds.repository_full_name']) }} as daily_metric_id,
        ds.metric_date,
        ds.repository_full_name,

        -- Commit metrics
        coalesce(dc.commits_count, 0) as commits_count,
        coalesce(dc.unique_committers, 0) as unique_committers,

        -- Issue metrics
        coalesce(di.issues_created, 0) as issues_created,
        coalesce(di.issues_closed, 0) as issues_closed,

        -- PR metrics
        coalesce(dp.prs_created, 0) as prs_created,
        coalesce(dp.prs_merged, 0) as prs_merged,

        -- Star metrics
        coalesce(dst.stars_received, 0) as stars_received,

        -- Workflow metrics
        coalesce(dw.workflow_runs_total, 0) as workflow_runs_total,
        coalesce(dw.workflow_runs_success, 0) as workflow_runs_success,
        coalesce(dw.workflow_runs_failure, 0) as workflow_runs_failure,

        -- Calculated metrics
        case
            when coalesce(dw.workflow_runs_total, 0) > 0
            then round(100.0 * coalesce(dw.workflow_runs_success, 0) / dw.workflow_runs_total, 2)
            else null
        end as workflow_success_rate,

        coalesce(dc.commits_count, 0) +
        coalesce(di.issues_created, 0) +
        coalesce(dp.prs_created, 0) as total_activity_count,

        current_timestamp as aggregation_updated_at

    from date_spine ds
    left join daily_commits dc
        on ds.metric_date = dc.metric_date
        and ds.repository_full_name = dc.repository_full_name
    left join daily_issues di
        on ds.metric_date = di.metric_date
        and ds.repository_full_name = di.repository_full_name
    left join daily_prs dp
        on ds.metric_date = dp.metric_date
        and ds.repository_full_name = dp.repository_full_name
    left join daily_stars dst
        on ds.metric_date = dst.metric_date
        and ds.repository_full_name = dst.repository_full_name
    left join daily_workflows dw
        on ds.metric_date = dw.metric_date
        and ds.repository_full_name = dw.repository_full_name

    {% if is_incremental() %}
        -- Only process new dates
        where ds.metric_date > (select max(metric_date) from {{ this }})
    {% endif %}
)

select * from final
