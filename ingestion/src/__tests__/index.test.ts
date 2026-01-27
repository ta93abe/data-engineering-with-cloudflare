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
