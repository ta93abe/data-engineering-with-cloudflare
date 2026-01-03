{{
    config(
        materialized='table',
        tags=['marts', 'dimension']
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

commit_authors as (
    select distinct
        author_name as contributor_name,
        author_email as contributor_email,
        'commit_author' as contribution_type
    from commits
),

issue_creators as (
    select distinct
        creator_login as contributor_name,
        null as contributor_email,
        'issue_creator' as contribution_type
    from issues
),

pr_creators as (
    select distinct
        creator_login as contributor_name,
        null as contributor_email,
        'pr_creator' as contribution_type
    from pull_requests
),

all_contributors as (
    select * from commit_authors
    union all
    select * from issue_creators
    union all
    select * from pr_creators
),

contributor_summary as (
    select
        coalesce(contributor_name, contributor_email) as contributor_key,
        contributor_name,
        contributor_email,
        count(distinct contribution_type) as contribution_types_count,
        max(case when contribution_type = 'commit_author' then 1 else 0 end) as has_commits,
        max(case when contribution_type = 'issue_creator' then 1 else 0 end) as has_issues,
        max(case when contribution_type = 'pr_creator' then 1 else 0 end) as has_prs
    from all_contributors
    group by contributor_key, contributor_name, contributor_email
),

contributor_activity as (
    select
        author_name as contributor_name,
        count(*) as total_commits,
        count(distinct repository_full_name) as repositories_contributed,
        min(author_date) as first_contribution_at,
        max(author_date) as last_contribution_at
    from commits
    group by author_name
),

final as (
    select
        {{ dbt_utils.generate_surrogate_key(['cs.contributor_key']) }} as contributor_id,
        cs.contributor_key,
        cs.contributor_name,
        cs.contributor_email,

        -- Activity flags
        cs.has_commits,
        cs.has_issues,
        cs.has_prs,
        cs.contribution_types_count,

        -- Metrics
        coalesce(ca.total_commits, 0) as total_commits,
        coalesce(ca.repositories_contributed, 0) as repositories_contributed,

        -- Dates
        ca.first_contribution_at,
        ca.last_contribution_at,

        -- Calculated dimensions
        case
            when ca.first_contribution_at >= current_date - interval '30 days' then 'New'
            when ca.last_contribution_at >= current_date - interval '30 days' then 'Active'
            when ca.last_contribution_at >= current_date - interval '90 days' then 'Occasional'
            else 'Inactive'
        end as activity_status,

        case
            when ca.total_commits >= 50 then 'High'
            when ca.total_commits >= 10 then 'Medium'
            when ca.total_commits >= 1 then 'Low'
            else 'None'
        end as commit_activity_tier,

        current_timestamp as dimension_updated_at

    from contributor_summary cs
    left join contributor_activity ca
        on cs.contributor_name = ca.contributor_name
)

select * from final
