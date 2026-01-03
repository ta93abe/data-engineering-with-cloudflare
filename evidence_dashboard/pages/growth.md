# 📈 Growth Metrics

Star growth, activity trends, and repository momentum.

## Growth Overview

```sql growth_summary
select
    sum(current_stars) as total_stars,
    count(*) as total_repos,
    avg(age_in_days) as avg_repo_age_days
from marts.dim_repositories
```

<div class="grid grid-cols-3 gap-4">
  <BigValue
    data={growth_summary}
    value=total_stars
    title="Total Stars"
  />

  <BigValue
    data={growth_summary}
    value=total_repos
    title="Total Repositories"
  />

  <BigValue
    data={growth_summary}
    value=avg_repo_age_days
    title="Avg Repository Age (days)"
    fmt=num0
  />
</div>

## Daily Activity Trend (Last 90 Days)

```sql daily_activity
select
    metric_date,
    sum(commits_count) as commits,
    sum(issues_created) as issues,
    sum(prs_created) as prs,
    sum(stars_received) as stars,
    sum(total_activity_count) as total_activity
from marts.agg_daily_metrics
where metric_date >= current_date - interval '90 days'
group by metric_date
order by metric_date
```

<LineChart
    data={daily_activity}
    x=metric_date
    y={['commits', 'issues', 'prs', 'stars']}
    title="Daily Activity Breakdown"
/>

<LineChart
    data={daily_activity}
    x=metric_date
    y=total_activity
    title="Total Daily Activity"
/>

## Star Growth Trend

```sql star_growth
select
    metric_date,
    sum(stars_received) as daily_stars,
    sum(sum(stars_received)) over (order by metric_date) as cumulative_stars
from marts.agg_daily_metrics
where metric_date >= current_date - interval '90 days'
group by metric_date
order by metric_date
```

<LineChart
    data={star_growth}
    x=metric_date
    y=daily_stars
    title="Daily Star Growth"
/>

<LineChart
    data={star_growth}
    x=metric_date
    y=cumulative_stars
    title="Cumulative Stars (Last 90 Days)"
/>

## Most Active Repositories (Last 30 Days)

```sql most_active
select
    repository_full_name,
    sum(commits_count) as commits,
    sum(issues_created) as issues_created,
    sum(prs_created) as prs_created,
    sum(stars_received) as stars_received,
    sum(total_activity_count) as total_activity
from marts.agg_daily_metrics
where metric_date >= current_date - interval '30 days'
group by repository_full_name
order by total_activity desc
limit 10
```

<DataTable data={most_active}>
  <Column id=repository_full_name title="Repository"/>
  <Column id=commits title="Commits" fmt=num0 contentType=colorscale scaleColor=blue/>
  <Column id=issues_created title="Issues" fmt=num0 contentType=colorscale scaleColor=yellow/>
  <Column id=prs_created title="PRs" fmt=num0 contentType=colorscale scaleColor=green/>
  <Column id=stars_received title="Stars" fmt=num0 contentType=colorscale scaleColor=purple/>
  <Column id=total_activity title="Total Activity" fmt=num0/>
</DataTable>

## Repository Momentum

```sql repository_momentum
select
    r.repository_full_name,
    r.current_stars,
    r.age_in_days,
    round(r.current_stars * 1.0 / nullif(r.age_in_days, 0), 2) as stars_per_day,
    recent.total_activity as activity_last_30_days
from marts.dim_repositories r
left join (
    select
        repository_full_name,
        sum(total_activity_count) as total_activity
    from marts.agg_daily_metrics
    where metric_date >= current_date - interval '30 days'
    group by repository_full_name
) recent on r.repository_full_name = recent.repository_full_name
where r.age_in_days > 0
order by stars_per_day desc
limit 15
```

<DataTable data={repository_momentum}>
  <Column id=repository_full_name title="Repository"/>
  <Column id=current_stars title="Total Stars" fmt=num0/>
  <Column id=age_in_days title="Age (days)" fmt=num0/>
  <Column id=stars_per_day title="Stars/Day" fmt=num2 contentType=colorscale scaleColor=purple/>
  <Column id=activity_last_30_days title="Recent Activity" fmt=num0/>
</DataTable>

## Activity Distribution by Day of Week

```sql activity_by_dow
select
    extract(dow from metric_date) as day_of_week,
    case extract(dow from metric_date)
        when 0 then 'Sunday'
        when 1 then 'Monday'
        when 2 then 'Tuesday'
        when 3 then 'Wednesday'
        when 4 then 'Thursday'
        when 5 then 'Friday'
        when 6 then 'Saturday'
    end as day_name,
    sum(commits_count) as total_commits,
    sum(issues_created) as total_issues,
    sum(prs_created) as total_prs
from marts.agg_daily_metrics
where metric_date >= current_date - interval '90 days'
group by day_of_week, day_name
order by day_of_week
```

<BarChart
    data={activity_by_dow}
    x=day_name
    y={['total_commits', 'total_issues', 'total_prs']}
    title="Activity Distribution by Day of Week"
/>

## Weekly Activity Summary

```sql weekly_summary
select
    date_trunc('week', metric_date) as week,
    sum(commits_count) as commits,
    sum(issues_created) as issues,
    sum(prs_created) as prs,
    sum(stars_received) as stars,
    count(distinct repository_full_name) as active_repos
from marts.agg_daily_metrics
where metric_date >= current_date - interval '90 days'
group by week
order by week
```

<LineChart
    data={weekly_summary}
    x=week
    y={['commits', 'issues', 'prs']}
    title="Weekly Activity Trend"
/>

<DataTable data={weekly_summary}>
  <Column id=week title="Week" fmt=date/>
  <Column id=commits title="Commits" fmt=num0/>
  <Column id=issues title="Issues" fmt=num0/>
  <Column id=prs title="PRs" fmt=num0/>
  <Column id=stars title="Stars" fmt=num0/>
  <Column id=active_repos title="Active Repos" fmt=num0/>
</DataTable>
