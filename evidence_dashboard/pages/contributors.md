# 👥 Contributors

Contributor activity, rankings, and engagement.

## Contributor Overview

```sql contributor_summary
select
    count(*) as total_contributors,
    sum(case when activity_status = 'Active' then 1 else 0 end) as active_contributors,
    sum(total_commits) as total_commits,
    avg(total_commits) as avg_commits_per_contributor
from marts.dim_contributors
```

<div class="grid grid-cols-3 gap-4">
  <BigValue
    data={contributor_summary}
    value=total_contributors
    title="Total Contributors"
  />

  <BigValue
    data={contributor_summary}
    value=active_contributors
    title="Active Contributors"
  />

  <BigValue
    data={contributor_summary}
    value=avg_commits_per_contributor
    title="Avg Commits/Contributor"
    fmt=num1
  />
</div>

## Activity Status Distribution

```sql activity_status
select
    activity_status,
    count(*) as contributor_count
from marts.dim_contributors
group by activity_status
order by
    case activity_status
        when 'New' then 1
        when 'Active' then 2
        when 'Occasional' then 3
        when 'Inactive' then 4
    end
```

<BarChart
    data={activity_status}
    x=activity_status
    y=contributor_count
    title="Contributors by Activity Status"
/>

## Commit Activity Tiers

```sql commit_tiers
select
    commit_activity_tier,
    count(*) as contributor_count,
    avg(total_commits) as avg_commits
from marts.dim_contributors
group by commit_activity_tier
order by
    case commit_activity_tier
        when 'High' then 1
        when 'Medium' then 2
        when 'Low' then 3
        when 'None' then 4
    end
```

<BarChart
    data={commit_tiers}
    x=commit_activity_tier
    y=contributor_count
    title="Contributors by Commit Activity"
    swapXY=true
/>

## Top Contributors by Commits

```sql top_committers
select
    contributor_name,
    total_commits,
    repositories_contributed,
    activity_status,
    commit_activity_tier,
    first_contribution_at,
    last_contribution_at
from marts.dim_contributors
order by total_commits desc
limit 20
```

<DataTable data={top_committers} rows=10>
  <Column id=contributor_name title="Contributor"/>
  <Column id=total_commits title="Total Commits" fmt=num0/>
  <Column id=repositories_contributed title="Repos Contributed" fmt=num0/>
  <Column id=activity_status title="Status"/>
  <Column id=commit_activity_tier title="Activity Tier"/>
  <Column id=last_contribution_at title="Last Contribution" fmt=date/>
</DataTable>

## Contribution Types Distribution

```sql contribution_types
select
    contribution_types_count,
    count(*) as contributor_count
from marts.dim_contributors
group by contribution_types_count
order by contribution_types_count desc
```

<BarChart
    data={contribution_types}
    x=contribution_types_count
    y=contributor_count
    title="Contributors by Number of Contribution Types"
    xAxisTitle="Contribution Types (commits, issues, PRs)"
/>

## Multi-Repository Contributors

```sql multi_repo_contributors
select
    contributor_name,
    repositories_contributed,
    total_commits,
    activity_status
from marts.dim_contributors
where repositories_contributed > 1
order by repositories_contributed desc, total_commits desc
limit 15
```

<DataTable data={multi_repo_contributors}>
  <Column id=contributor_name title="Contributor"/>
  <Column id=repositories_contributed title="Repositories" fmt=num0/>
  <Column id=total_commits title="Total Commits" fmt=num0/>
  <Column id=activity_status title="Status"/>
</DataTable>

## Contributor Engagement Matrix

```sql engagement_matrix
select
    contributor_name,
    total_commits,
    has_commits,
    has_issues,
    has_prs,
    activity_status
from marts.dim_contributors
where total_commits > 0
order by total_commits desc
limit 20
```

<DataTable data={engagement_matrix}>
  <Column id=contributor_name title="Contributor"/>
  <Column id=total_commits title="Commits" fmt=num0 contentType=colorscale scaleColor=blue/>
  <Column id=has_commits title="Has Commits" fmt=bool/>
  <Column id=has_issues title="Has Issues" fmt=bool/>
  <Column id=has_prs title="Has PRs" fmt=bool/>
  <Column id=activity_status title="Status"/>
</DataTable>

## New Contributors (Last 90 Days)

```sql new_contributors
select
    contributor_name,
    total_commits,
    repositories_contributed,
    first_contribution_at,
    last_contribution_at
from marts.dim_contributors
where first_contribution_at >= current_date - interval '90 days'
order by first_contribution_at desc
```

<DataTable data={new_contributors}>
  <Column id=contributor_name title="Contributor"/>
  <Column id=total_commits title="Commits" fmt=num0/>
  <Column id=repositories_contributed title="Repos" fmt=num0/>
  <Column id=first_contribution_at title="First Contribution" fmt=date/>
  <Column id=last_contribution_at title="Last Contribution" fmt=date/>
</DataTable>
