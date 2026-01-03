# GitHub Analytics Dashboard

Welcome to your GitHub Analytics Dashboard powered by Evidence.dev and dbt.

## Quick Navigation

<div class="grid grid-cols-2 gap-4">
  <a href="/repositories" class="card p-4 hover:shadow-lg">
    <h3>📦 Repositories</h3>
    <p>Repository overview and metrics</p>
  </a>

  <a href="/issues" class="card p-4 hover:shadow-lg">
    <h3>🐛 Issues Analysis</h3>
    <p>Issue lifecycle and resolution times</p>
  </a>

  <a href="/pull-requests" class="card p-4 hover:shadow-lg">
    <h3>🔀 Pull Requests</h3>
    <p>PR metrics and merge analysis</p>
  </a>

  <a href="/contributors" class="card p-4 hover:shadow-lg">
    <h3>👥 Contributors</h3>
    <p>Contributor activity and rankings</p>
  </a>

  <a href="/cicd" class="card p-4 hover:shadow-lg">
    <h3>⚙️ CI/CD Performance</h3>
    <p>Workflow success rates and trends</p>
  </a>

  <a href="/growth" class="card p-4 hover:shadow-lg">
    <h3>📈 Growth Metrics</h3>
    <p>Star growth and activity trends</p>
  </a>
</div>

## Overview KPIs

```sql repos_count
select count(*) as total_repositories
from marts.dim_repositories
```

```sql total_stars
select sum(current_stars) as total_stars
from marts.dim_repositories
```

```sql total_commits
select sum(total_commits) as total_commits
from marts.fct_repository_activity
```

```sql total_prs
select sum(total_prs) as total_prs
from marts.fct_repository_activity
```

<div class="grid grid-cols-4 gap-4">
  <BigValue
    data={repos_count}
    value=total_repositories
    title="Total Repositories"
  />

  <BigValue
    data={total_stars}
    value=total_stars
    title="Total Stars"
  />

  <BigValue
    data={total_commits}
    value=total_commits
    title="Total Commits"
  />

  <BigValue
    data={total_prs}
    value=total_prs
    title="Total PRs"
  />
</div>

## Recent Activity (Last 30 Days)

```sql recent_activity
select
    metric_date,
    sum(commits_count) as commits,
    sum(issues_created) as issues,
    sum(prs_created) as prs,
    sum(stars_received) as stars
from marts.agg_daily_metrics
where metric_date >= current_date - interval '30 days'
group by metric_date
order by metric_date desc
```

<LineChart
    data={recent_activity}
    x=metric_date
    y={['commits', 'issues', 'prs']}
    title="Daily Activity Trend"
/>

## Top Repositories by Stars

```sql top_repos
select
    repository_full_name,
    current_stars,
    current_forks,
    primary_language,
    repository_age_category
from marts.dim_repositories
order by current_stars desc
limit 10
```

<DataTable data={top_repos} rows=10>
  <Column id=repository_full_name title="Repository"/>
  <Column id=current_stars title="Stars" fmt=num0/>
  <Column id=current_forks title="Forks" fmt=num0/>
  <Column id=primary_language title="Language"/>
  <Column id=repository_age_category title="Age"/>
</DataTable>

## Repository Health Score

```sql health_scores
select
    r.repository_full_name,
    r.current_stars,
    a.merged_prs * 1.0 / nullif(a.total_prs, 0) as pr_merge_rate,
    a.closed_issues * 1.0 / nullif(a.total_issues, 0) as issue_close_rate,
    a.successful_runs * 1.0 / nullif(a.total_workflow_runs, 0) as ci_success_rate
from marts.dim_repositories r
join marts.fct_repository_activity a
    on r.repository_id = a.repository_id
where a.total_prs > 0 or a.total_issues > 0
order by r.current_stars desc
limit 5
```

<DataTable data={health_scores}>
  <Column id=repository_full_name title="Repository"/>
  <Column id=current_stars title="Stars" fmt=num0/>
  <Column id=pr_merge_rate title="PR Merge Rate" fmt=pct1/>
  <Column id=issue_close_rate title="Issue Close Rate" fmt=pct1/>
  <Column id=ci_success_rate title="CI Success Rate" fmt=pct1/>
</DataTable>
