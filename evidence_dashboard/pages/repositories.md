# 📦 Repositories

Comprehensive repository metrics and analysis.

## Repository Overview

```sql repo_summary
select
    count(*) as total_repos,
    sum(case when is_private then 1 else 0 end) as private_repos,
    sum(case when is_archived then 1 else 0 end) as archived_repos,
    sum(case when is_organization_owned then 1 else 0 end) as org_repos,
    sum(current_stars) as total_stars,
    sum(current_forks) as total_forks
from marts.dim_repositories
```

<div class="grid grid-cols-3 gap-4">
  <BigValue
    data={repo_summary}
    value=total_repos
    title="Total Repositories"
  />

  <BigValue
    data={repo_summary}
    value=total_stars
    title="Total Stars"
  />

  <BigValue
    data={repo_summary}
    value=total_forks
    title="Total Forks"
  />
</div>

## Repositories by Language

```sql repos_by_language
select
    primary_language,
    count(*) as repo_count,
    sum(current_stars) as total_stars,
    avg(current_stars) as avg_stars
from marts.dim_repositories
where primary_language is not null
group by primary_language
order by repo_count desc
```

<BarChart
    data={repos_by_language}
    x=primary_language
    y=repo_count
    title="Repositories by Programming Language"
/>

<DataTable data={repos_by_language}>
  <Column id=primary_language title="Language"/>
  <Column id=repo_count title="Repository Count" fmt=num0/>
  <Column id=total_stars title="Total Stars" fmt=num0/>
  <Column id=avg_stars title="Avg Stars" fmt=num1/>
</DataTable>

## Repository Age Distribution

```sql repos_by_age
select
    repository_age_category,
    count(*) as repo_count,
    avg(current_stars) as avg_stars
from marts.dim_repositories
group by repository_age_category
order by
    case repository_age_category
        when 'New' then 1
        when 'Recent' then 2
        when 'Established' then 3
        when 'Mature' then 4
    end
```

<BarChart
    data={repos_by_age}
    x=repository_age_category
    y=repo_count
    title="Repositories by Age Category"
/>

## Star Popularity Tiers

```sql star_tiers
select
    star_popularity_tier,
    count(*) as repo_count
from marts.dim_repositories
group by star_popularity_tier
order by
    case star_popularity_tier
        when 'High' then 1
        when 'Medium' then 2
        when 'Low' then 3
        when 'Minimal' then 4
    end
```

<BarChart
    data={star_tiers}
    x=star_popularity_tier
    y=repo_count
    title="Repository Distribution by Star Tier"
    swapXY=true
/>

## All Repositories

```sql all_repos
select
    r.repository_full_name,
    r.primary_language,
    r.current_stars,
    r.current_forks,
    r.current_open_issues,
    r.star_popularity_tier,
    r.repository_age_category,
    r.created_at,
    a.total_commits,
    a.total_prs,
    a.merged_prs,
    a.unique_contributors
from marts.dim_repositories r
left join marts.fct_repository_activity a
    on r.repository_id = a.repository_id
order by r.current_stars desc
```

<DataTable data={all_repos} search=true>
  <Column id=repository_full_name title="Repository"/>
  <Column id=primary_language title="Language"/>
  <Column id=current_stars title="Stars" fmt=num0/>
  <Column id=current_forks title="Forks" fmt=num0/>
  <Column id=total_commits title="Commits" fmt=num0/>
  <Column id=total_prs title="PRs" fmt=num0/>
  <Column id=merged_prs title="Merged" fmt=num0/>
  <Column id=unique_contributors title="Contributors" fmt=num0/>
  <Column id=star_popularity_tier title="Star Tier"/>
  <Column id=repository_age_category title="Age"/>
</DataTable>

## Repository Activity Heatmap

```sql repo_activity
select
    r.repository_full_name,
    a.total_commits,
    a.total_issues,
    a.total_prs,
    a.total_releases
from marts.dim_repositories r
join marts.fct_repository_activity a
    on r.repository_id = a.repository_id
where a.total_commits > 0
order by a.total_commits desc
limit 10
```

<DataTable data={repo_activity}>
  <Column id=repository_full_name title="Repository"/>
  <Column id=total_commits title="Commits" fmt=num0 contentType=colorscale scaleColor=blue/>
  <Column id=total_issues title="Issues" fmt=num0 contentType=colorscale scaleColor=yellow/>
  <Column id=total_prs title="PRs" fmt=num0 contentType=colorscale scaleColor=green/>
  <Column id=total_releases title="Releases" fmt=num0 contentType=colorscale scaleColor=purple/>
</DataTable>
