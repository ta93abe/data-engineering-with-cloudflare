# 🔀 Pull Requests

PR metrics, merge analysis, and code review insights.

## PR Overview

```sql pr_summary
select
    count(*) as total_prs,
    sum(is_merged) as merged_prs,
    sum(is_open) as open_prs,
    avg(case when is_merged = 1 then hours_to_merge end) as avg_hours_to_merge,
    sum(total_changes) as total_code_changes
from marts.fct_pr_metrics
```

<div class="grid grid-cols-4 gap-4">
  <BigValue
    data={pr_summary}
    value=total_prs
    title="Total PRs"
  />

  <BigValue
    data={pr_summary}
    value=merged_prs
    title="Merged PRs"
  />

  <BigValue
    data={pr_summary}
    value=avg_hours_to_merge
    title="Avg Hours to Merge"
    fmt=num1
  />

  <BigValue
    data={pr_summary}
    value=total_code_changes
    title="Total Code Changes"
    fmt=num0
  />
</div>

## PR Size Distribution

```sql pr_sizes
select
    pr_size_category,
    count(*) as pr_count,
    avg(hours_to_merge) as avg_hours_to_merge,
    avg(review_comments_count) as avg_review_comments
from marts.fct_pr_metrics
where is_merged = 1
group by pr_size_category
order by
    case pr_size_category
        when 'XS' then 1
        when 'S' then 2
        when 'M' then 3
        when 'L' then 4
        when 'XL' then 5
    end
```

<BarChart
    data={pr_sizes}
    x=pr_size_category
    y=pr_count
    title="PRs by Size Category"
/>

<DataTable data={pr_sizes}>
  <Column id=pr_size_category title="PR Size"/>
  <Column id=pr_count title="PR Count" fmt=num0/>
  <Column id=avg_hours_to_merge title="Avg Hours to Merge" fmt=num1/>
  <Column id=avg_review_comments title="Avg Review Comments" fmt=num1/>
</DataTable>

## Merge Speed Analysis

```sql merge_speed
select
    merge_speed_category,
    count(*) as pr_count,
    avg(hours_to_merge) as avg_hours
from marts.fct_pr_metrics
where is_merged = 1
group by merge_speed_category
order by
    case merge_speed_category
        when 'Fast' then 1
        when 'Normal' then 2
        when 'Slow' then 3
    end
```

<BarChart
    data={merge_speed}
    x=merge_speed_category
    y=pr_count
    title="PRs by Merge Speed"
    swapXY=true
/>

## Review Intensity Distribution

```sql review_intensity
select
    review_intensity,
    count(*) as pr_count,
    avg(review_comments_count) as avg_comments,
    avg(hours_to_merge) as avg_hours_to_merge
from marts.fct_pr_metrics
group by review_intensity
order by
    case review_intensity
        when 'No Review' then 1
        when 'Light Review' then 2
        when 'Moderate Review' then 3
        when 'Heavy Review' then 4
    end
```

<BarChart
    data={review_intensity}
    x=review_intensity
    y=pr_count
    title="PRs by Review Intensity"
/>

## PR Scope Analysis

```sql pr_scope
select
    scope_category,
    count(*) as pr_count,
    avg(changed_files_count) as avg_files_changed
from marts.fct_pr_metrics
group by scope_category
order by
    case scope_category
        when 'Focused' then 1
        when 'Moderate' then 2
        when 'Wide-Reaching' then 3
    end
```

<BarChart
    data={pr_scope}
    x=scope_category
    y=pr_count
    title="PRs by Scope"
/>

## Top Merge Efficiency

```sql efficient_prs
select
    repository_full_name,
    pr_number,
    pr_title,
    pr_size_category,
    hours_to_merge,
    merge_efficiency_score,
    total_changes
from marts.fct_pr_metrics
where is_merged = 1 and merge_efficiency_score is not null
order by merge_efficiency_score desc
limit 20
```

<DataTable data={efficient_prs} rows=10>
  <Column id=repository_full_name title="Repository"/>
  <Column id=pr_number title="PR#" fmt=num0/>
  <Column id=pr_title title="Title"/>
  <Column id=pr_size_category title="Size"/>
  <Column id=hours_to_merge title="Hours to Merge" fmt=num1/>
  <Column id=total_changes title="Total Changes" fmt=num0/>
  <Column id=merge_efficiency_score title="Efficiency Score" fmt=num2/>
</DataTable>

## Recent PRs

```sql recent_prs
select
    pr_number,
    repository_full_name,
    pr_title,
    pr_state,
    creator_login,
    pr_created_at,
    is_merged,
    hours_to_merge,
    pr_size_category,
    total_changes,
    review_comments_count
from marts.fct_pr_metrics
order by pr_created_at desc
limit 50
```

<DataTable data={recent_prs} search=true rows=20>
  <Column id=repository_full_name title="Repository"/>
  <Column id=pr_number title="PR#" fmt=num0/>
  <Column id=pr_title title="Title"/>
  <Column id=pr_state title="State"/>
  <Column id=creator_login title="Creator"/>
  <Column id=pr_size_category title="Size"/>
  <Column id=total_changes title="Changes" fmt=num0/>
  <Column id=hours_to_merge title="Hours to Merge" fmt=num1/>
  <Column id=review_comments_count title="Review Comments" fmt=num0/>
</DataTable>

## PR Merge Rate by Repository

```sql pr_merge_rate
select
    repository_full_name,
    count(*) as total_prs,
    sum(is_merged) as merged_prs,
    round(100.0 * sum(is_merged) / count(*), 1) as merge_rate_pct
from marts.fct_pr_metrics
group by repository_full_name
having count(*) >= 3
order by merge_rate_pct desc
```

<DataTable data={pr_merge_rate}>
  <Column id=repository_full_name title="Repository"/>
  <Column id=total_prs title="Total PRs" fmt=num0/>
  <Column id=merged_prs title="Merged" fmt=num0/>
  <Column id=merge_rate_pct title="Merge Rate" fmt=pct0 contentType=colorscale scaleColor=green/>
</DataTable>
