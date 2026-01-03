# 🐛 Issues Analysis

Issue lifecycle, resolution times, and trends.

## Issue Overview

```sql issue_summary
select
    count(*) as total_issues,
    sum(is_open) as open_issues,
    sum(is_closed) as closed_issues,
    avg(case when is_closed = 1 then days_to_close end) as avg_days_to_close,
    sum(is_bug) as bug_count,
    sum(is_enhancement) as enhancement_count
from marts.fct_issue_lifecycle
```

<div class="grid grid-cols-3 gap-4">
  <BigValue
    data={issue_summary}
    value=total_issues
    title="Total Issues"
  />

  <BigValue
    data={issue_summary}
    value=open_issues
    title="Open Issues"
    comparison=closed_issues
    comparisonTitle="Closed"
  />

  <BigValue
    data={issue_summary}
    value=avg_days_to_close
    title="Avg Days to Close"
    fmt=num1
  />
</div>

## Resolution Time Distribution

```sql resolution_buckets
select
    resolution_time_bucket,
    count(*) as issue_count,
    avg(days_to_close) as avg_days
from marts.fct_issue_lifecycle
where is_closed = 1
group by resolution_time_bucket
order by
    case resolution_time_bucket
        when 'Same Day' then 1
        when 'Within Week' then 2
        when 'Within Month' then 3
        when 'Over Month' then 4
    end
```

<BarChart
    data={resolution_buckets}
    x=resolution_time_bucket
    y=issue_count
    title="Issues by Resolution Time"
/>

<DataTable data={resolution_buckets}>
  <Column id=resolution_time_bucket title="Resolution Time"/>
  <Column id=issue_count title="Issue Count" fmt=num0/>
  <Column id=avg_days title="Avg Days to Close" fmt=num1/>
</DataTable>

## Discussion Level Analysis

```sql discussion_levels
select
    discussion_level,
    count(*) as issue_count,
    avg(comments_count) as avg_comments
from marts.fct_issue_lifecycle
group by discussion_level
order by
    case discussion_level
        when 'No Discussion' then 1
        when 'Low Discussion' then 2
        when 'Medium Discussion' then 3
        when 'High Discussion' then 4
    end
```

<BarChart
    data={discussion_levels}
    x=discussion_level
    y=issue_count
    title="Issues by Discussion Level"
/>

## Issue Types Distribution

```sql issue_types
select
    case
        when is_bug = 1 then 'Bug'
        when is_enhancement = 1 then 'Enhancement'
        when is_documentation = 1 then 'Documentation'
        else 'Other'
    end as issue_type,
    count(*) as issue_count
from marts.fct_issue_lifecycle
group by issue_type
order by issue_count desc
```

<BarChart
    data={issue_types}
    x=issue_type
    y=issue_count
    title="Issues by Type"
    swapXY=true
/>

## Open Issues by Repository

```sql open_by_repo
select
    repository_full_name,
    count(*) as open_issues,
    avg(days_since_creation) as avg_age_days
from marts.fct_issue_lifecycle
where is_open = 1
group by repository_full_name
order by open_issues desc
```

<DataTable data={open_by_repo}>
  <Column id=repository_full_name title="Repository"/>
  <Column id=open_issues title="Open Issues" fmt=num0/>
  <Column id=avg_age_days title="Avg Age (days)" fmt=num0/>
</DataTable>

## Recent Issues

```sql recent_issues
select
    issue_number,
    repository_full_name,
    issue_title,
    issue_state,
    creator_login,
    issue_created_at,
    days_to_close,
    resolution_time_bucket,
    discussion_level,
    is_bug,
    is_enhancement
from marts.fct_issue_lifecycle
order by issue_created_at desc
limit 50
```

<DataTable data={recent_issues} search=true rows=20>
  <Column id=repository_full_name title="Repository"/>
  <Column id=issue_number title="#" fmt=num0/>
  <Column id=issue_title title="Title"/>
  <Column id=issue_state title="State"/>
  <Column id=creator_login title="Creator"/>
  <Column id=issue_created_at title="Created" fmt=date/>
  <Column id=days_to_close title="Days to Close" fmt=num0/>
  <Column id=discussion_level title="Discussion"/>
</DataTable>

## Issue Resolution Trend (Last 90 Days)

```sql issue_trend
select
    date_trunc('week', i.issue_created_at) as week,
    count(*) as issues_created,
    sum(case when i.is_closed = 1 then 1 else 0 end) as issues_closed
from marts.fct_issue_lifecycle i
where i.issue_created_at >= current_date - interval '90 days'
group by week
order by week
```

<LineChart
    data={issue_trend}
    x=week
    y={['issues_created', 'issues_closed']}
    title="Weekly Issue Creation vs Closure"
/>
