# ⚙️ CI/CD Performance

Workflow execution metrics, success rates, and trends.

## CI/CD Overview

```sql cicd_summary
select
    sum(total_workflow_runs) as total_runs,
    sum(successful_runs) as successful_runs,
    sum(failed_runs) as failed_runs,
    round(100.0 * sum(successful_runs) / nullif(sum(total_workflow_runs), 0), 1) as success_rate_pct,
    avg(avg_workflow_duration_seconds) as avg_duration_seconds
from marts.fct_repository_activity
where total_workflow_runs > 0
```

<div class="grid grid-cols-4 gap-4">
  <BigValue
    data={cicd_summary}
    value=total_runs
    title="Total Workflow Runs"
  />

  <BigValue
    data={cicd_summary}
    value=successful_runs
    title="Successful Runs"
  />

  <BigValue
    data={cicd_summary}
    value=success_rate_pct
    title="Success Rate"
    fmt=pct0
  />

  <BigValue
    data={cicd_summary}
    value=avg_duration_seconds
    title="Avg Duration (sec)"
    fmt=num0
  />
</div>

## Success Rate by Repository

```sql success_by_repo
select
    repository_full_name,
    total_workflow_runs,
    successful_runs,
    failed_runs,
    round(100.0 * successful_runs / total_workflow_runs, 1) as success_rate_pct
from marts.fct_repository_activity
where total_workflow_runs > 0
order by total_workflow_runs desc
```

<DataTable data={success_by_repo}>
  <Column id=repository_full_name title="Repository"/>
  <Column id=total_workflow_runs title="Total Runs" fmt=num0/>
  <Column id=successful_runs title="Successful" fmt=num0/>
  <Column id=failed_runs title="Failed" fmt=num0/>
  <Column id=success_rate_pct title="Success Rate" fmt=pct0 contentType=colorscale scaleColor=green/>
</DataTable>

## Daily Workflow Trend (Last 30 Days)

```sql daily_workflow_trend
select
    metric_date,
    sum(workflow_runs_total) as total_runs,
    sum(workflow_runs_success) as successful_runs,
    sum(workflow_runs_failure) as failed_runs,
    avg(workflow_success_rate) as avg_success_rate
from marts.agg_daily_metrics
where metric_date >= current_date - interval '30 days'
  and workflow_runs_total > 0
group by metric_date
order by metric_date
```

<LineChart
    data={daily_workflow_trend}
    x=metric_date
    y={['successful_runs', 'failed_runs']}
    title="Daily Workflow Runs (Success vs Failure)"
/>

<LineChart
    data={daily_workflow_trend}
    x=metric_date
    y=avg_success_rate
    title="Daily Average Success Rate"
    yFmt=pct0
/>

## Workflow Performance by Repository

```sql workflow_performance
select
    repository_full_name,
    avg_workflow_duration_seconds,
    total_workflow_runs,
    round(100.0 * successful_runs / total_workflow_runs, 1) as success_rate_pct
from marts.fct_repository_activity
where total_workflow_runs >= 5
order by avg_workflow_duration_seconds desc
```

<DataTable data={workflow_performance}>
  <Column id=repository_full_name title="Repository"/>
  <Column id=total_workflow_runs title="Total Runs" fmt=num0/>
  <Column id=avg_workflow_duration_seconds title="Avg Duration (sec)" fmt=num0 contentType=colorscale scaleColor=red/>
  <Column id=success_rate_pct title="Success Rate" fmt=pct0 contentType=colorscale scaleColor=green/>
</DataTable>

## CI/CD Health Score

```sql cicd_health
select
    repository_full_name,
    total_workflow_runs,
    round(100.0 * successful_runs / total_workflow_runs, 1) as success_rate,
    avg_workflow_duration_seconds,
    case
        when round(100.0 * successful_runs / total_workflow_runs, 1) >= 90 then 'Excellent'
        when round(100.0 * successful_runs / total_workflow_runs, 1) >= 75 then 'Good'
        when round(100.0 * successful_runs / total_workflow_runs, 1) >= 50 then 'Fair'
        else 'Needs Improvement'
    end as health_status
from marts.fct_repository_activity
where total_workflow_runs >= 3
order by success_rate desc
```

<DataTable data={cicd_health}>
  <Column id=repository_full_name title="Repository"/>
  <Column id=total_workflow_runs title="Total Runs" fmt=num0/>
  <Column id=success_rate title="Success Rate" fmt=pct0/>
  <Column id=avg_workflow_duration_seconds title="Avg Duration (sec)" fmt=num0/>
  <Column id=health_status title="Health Status"/>
</DataTable>
