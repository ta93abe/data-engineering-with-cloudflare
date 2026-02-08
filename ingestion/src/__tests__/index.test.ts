import { env, fetchMock, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const MIGRATION_SQL = `
create table if not exists github_users (
    id integer primary key,
    login text unique not null,
    name text,
    avatar_url text,
    synced_at text not null
);

create table if not exists github_repos (
    id integer primary key,
    owner_id integer not null,
    name text not null,
    full_name text unique not null,
    description text,
    language text,
    stars integer default 0,
    forks integer default 0,
    is_private integer default 0,
    default_branch text,
    synced_at text not null,
    foreign key (owner_id) references github_users(id)
);

create table if not exists github_commits (
    sha text primary key,
    repo_id integer not null,
    message text,
    author_name text,
    author_email text,
    author_date text not null,
    additions integer default 0,
    deletions integer default 0,
    files_changed integer default 0,
    synced_at text not null,
    foreign key (repo_id) references github_repos(id)
);

create index if not exists idx_github_commits_repo on github_commits(repo_id);
create index if not exists idx_github_commits_date on github_commits(author_date desc);
create index if not exists idx_github_repos_owner on github_repos(owner_id);
create index if not exists idx_github_repos_language on github_repos(language);

create view if not exists v_daily_commits as
select
    date(author_date) as commit_date,
    count(*) as commit_count,
    sum(additions) as total_additions,
    sum(deletions) as total_deletions,
    count(distinct repo_id) as repos_touched
from github_commits
group by date(author_date)
order by commit_date desc;

create view if not exists v_repo_stats as
select
    r.full_name,
    r.language,
    count(c.sha) as total_commits,
    sum(c.additions) as total_additions,
    sum(c.deletions) as total_deletions,
    max(c.author_date) as last_commit_date
from github_repos r
left join github_commits c on r.id = c.repo_id
group by r.id
order by total_commits desc;

create view if not exists v_weekly_activity as
select
    strftime('%Y-W%W', author_date) as week,
    count(*) as commits,
    count(distinct repo_id) as active_repos,
    sum(additions + deletions) as lines_changed
from github_commits
group by strftime('%Y-W%W', author_date)
order by week desc;

create table if not exists oauth_tokens (
    id text primary key,
    access_token text not null,
    refresh_token text not null,
    token_type text default 'Bearer',
    expires_at text not null,
    scope text,
    created_at text default (datetime('now')),
    updated_at text default (datetime('now'))
);

create table if not exists oura_daily_sleep (
    id text primary key,
    day text not null unique,
    score integer,
    timestamp text,
    deep_sleep integer,
    efficiency integer,
    latency integer,
    rem_sleep integer,
    restfulness integer,
    timing integer,
    total_sleep integer,
    synced_at text default (datetime('now'))
);

create table if not exists oura_daily_activity (
    id text primary key,
    day text not null unique,
    score integer,
    active_calories integer,
    total_calories integer,
    steps integer,
    equivalent_walking_distance real,
    high_activity_time integer,
    medium_activity_time integer,
    low_activity_time integer,
    sedentary_time integer,
    resting_time integer,
    met_average real,
    meet_daily_targets integer,
    move_every_hour integer,
    recovery_time integer,
    stay_active integer,
    training_frequency integer,
    training_volume integer,
    timestamp text,
    synced_at text default (datetime('now'))
);

create table if not exists oura_daily_readiness (
    id text primary key,
    day text not null unique,
    score integer,
    temperature_deviation real,
    temperature_trend_deviation real,
    timestamp text,
    activity_balance integer,
    body_temperature integer,
    hrv_balance integer,
    previous_day_activity integer,
    previous_night integer,
    recovery_index integer,
    resting_heart_rate integer,
    sleep_balance integer,
    synced_at text default (datetime('now'))
);

create table if not exists oura_heart_rate (
    id integer primary key autoincrement,
    bpm integer not null,
    source text,
    timestamp text not null,
    day text not null,
    synced_at text default (datetime('now'))
);

create view if not exists v_oura_daily_summary as
select
    s.day,
    s.score as sleep_score,
    a.score as activity_score,
    r.score as readiness_score,
    a.steps,
    a.total_calories,
    a.active_calories,
    r.temperature_deviation,
    s.deep_sleep as sleep_deep_sleep,
    s.efficiency as sleep_efficiency,
    s.total_sleep as sleep_total_sleep
from oura_daily_sleep s
left join oura_daily_activity a on s.day = a.day
left join oura_daily_readiness r on s.day = r.day
order by s.day desc;

create table if not exists data_sources (
    id text primary key,
    name text not null unique,
    source_type text not null,
    api_endpoint text,
    schedule_cron text,
    is_active integer default 1,
    config_json text,
    created_at text default (datetime('now')),
    updated_at text default (datetime('now'))
);

create table if not exists sync_state (
    id text primary key,
    data_source_id text not null,
    last_sync_at text,
    last_cursor text,
    metadata_json text,
    updated_at text default (datetime('now')),
    foreign key (data_source_id) references data_sources(id)
);

insert or ignore into data_sources (id, name, source_type, api_endpoint, schedule_cron)
values ('oura', 'Oura Ring', 'api', 'https://api.ouraring.com', '0 0 * * *');

insert or ignore into sync_state (id, data_source_id, last_sync_at)
values ('oura', 'oura', null);
`;

beforeAll(async () => {
  // Apply migrations
  const statements = MIGRATION_SQL.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const sql of statements) {
    await env.DB.prepare(sql).run();
  }

  // Set up fetch mock
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

describe("ingestion worker", () => {
  it("returns service info on GET /", async () => {
    const res = await SELF.fetch("https://example.com/");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toHaveProperty("name", "ingestion");
    expect(json).toHaveProperty("services");
    expect(json.services).toContain("github");
    expect(json.services).toContain("oura");
    expect(json.endpoints).toHaveProperty("oura");
  });

  it("returns health check on GET /health", async () => {
    const res = await SELF.fetch("https://example.com/health");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toEqual({ status: "ok" });
  });

  it("returns 404 for unknown routes", async () => {
    const res = await SELF.fetch("https://example.com/unknown");
    expect(res.status).toBe(404);
  });
});

describe("github service", () => {
  it("returns stats on GET /github/stats", async () => {
    const res = await SELF.fetch("https://example.com/github/stats");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toHaveProperty("repos");
    expect(json).toHaveProperty("commits");
  });

  it("returns daily commits on GET /github/daily", async () => {
    const res = await SELF.fetch("https://example.com/github/daily");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
  });

  it("syncs github data with mocked API", async () => {
    // Mock GitHub API responses
    fetchMock.get("https://api.github.com").intercept({ path: "/users/ta93abe" }).reply(200, {
      id: 12345,
      login: "ta93abe",
      name: "Test User",
      avatar_url: "https://example.com/avatar.png",
    });

    fetchMock
      .get("https://api.github.com")
      .intercept({ path: "/users/ta93abe/repos?per_page=100&sort=pushed" })
      .reply(200, [
        {
          id: 1,
          name: "test-repo",
          full_name: "ta93abe/test-repo",
          description: "A test repo",
          language: "TypeScript",
          stargazers_count: 10,
          forks_count: 2,
          private: false,
          default_branch: "main",
        },
      ]);

    fetchMock
      .get("https://api.github.com")
      .intercept({ path: "/repos/ta93abe/test-repo/commits?per_page=100" })
      .reply(200, [
        {
          sha: "abc123",
          commit: {
            message: "Initial commit",
            author: {
              name: "Test User",
              email: "test@example.com",
              date: "2026-01-27T00:00:00Z",
            },
          },
        },
      ]);

    const res = await SELF.fetch("https://example.com/github/sync", {
      method: "POST",
    });
    expect(res.status).toBe(200);

    const json = (await res.json()) as { service: string; success: boolean };
    expect(json.service).toBe("github");
    expect(json.success).toBe(true);
  });
});

describe("oura routes via index", () => {
  it("returns stats on GET /oura/stats", async () => {
    const res = await SELF.fetch("https://example.com/oura/stats");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toHaveProperty("sleep_records");
  });

  it("redirects on GET /oura/auth", async () => {
    const res = await SELF.fetch("https://example.com/oura/auth", { redirect: "manual" });
    expect(res.status).toBe(302);
  });
});
