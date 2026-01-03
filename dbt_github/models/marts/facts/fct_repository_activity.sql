{{
    config(
        materialized='table',
        tags=['marts', 'fact']
    )
}}

with repositories as (
    select * from {{ ref('dim_repositories') }}
),

issues as (
    select * from {{ ref('stg_github__issues') }}
),

pull_requests as (
    select * from {{ ref('stg_github__pull_requests') }}
),

commits as (
    select * from {{ ref('stg_github__commits') }}
),

stargazers as (
    select * from {{ ref('stg_github__stargazers') }}
),

releases as (
    select * from {{ ref('stg_github__releases') }}
),

workflow_runs as (
    select * from {{ ref('stg_github__workflow_runs') }}
),

repository_metrics as (
    select
        r.repository_id,
        r.repository_full_name,

        -- Issue metrics
        count(distinct i.issue_id) as total_issues,
        count(distinct case when i.is_open = 1 then i.issue_id end) as open_issues,
        count(distinct case when i.is_closed = 1 then i.issue_id end) as closed_issues,
        avg(case when i.is_closed = 1 then i.days_to_close end) as avg_days_to_close_issue,

        -- PR metrics
        count(distinct pr.pull_request_id) as total_prs,
        count(distinct case when pr.is_merged = 1 then pr.pull_request_id end) as merged_prs,
        count(distinct case when pr.is_open = 1 then pr.pull_request_id end) as open_prs,
        avg(case when pr.is_merged = 1 then pr.hours_to_merge end) as avg_hours_to_merge,

        -- Commit metrics
        count(distinct c.commit_sha) as total_commits,
        count(distinct c.author_email) as unique_contributors,
        max(c.author_date) as last_commit_at,

        -- Star metrics
        count(distinct s.user_login) as total_stars_events,
        max(s.starred_at) as last_starred_at,

        -- Release metrics
        count(distinct rel.release_id) as total_releases,
        count(distinct case when rel.is_stable_release = 1 then rel.release_id end) as stable_releases,
        max(rel.published_at) as last_release_at,

        -- CI/CD metrics
        count(distinct wr.workflow_run_id) as total_workflow_runs,
        count(distinct case when wr.is_success = 1 then wr.workflow_run_id end) as successful_runs,
        count(distinct case when wr.is_failure = 1 then wr.workflow_run_id end) as failed_runs,
        avg(case when wr.is_completed = 1 then wr.duration_seconds end) as avg_workflow_duration_seconds,

        current_timestamp as fact_updated_at

    from repositories r
    left join issues i on r.repository_full_name = i.repository_full_name
    left join pull_requests pr on r.repository_full_name = pr.repository_full_name
    left join commits c on r.repository_full_name = c.repository_full_name
    left join stargazers s on r.repository_full_name = s.repository_full_name
    left join releases rel on r.repository_full_name = rel.repository_full_name
    left join workflow_runs wr on r.repository_full_name = wr.repository_full_name
    group by r.repository_id, r.repository_full_name
)

select * from repository_metrics
