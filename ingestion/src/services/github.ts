import { Hono } from "hono";
import type { Env, SyncResult } from "../types";

const app = new Hono<{ Bindings: Env }>();

interface User {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
}

interface Repo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  private: boolean;
  default_branch: string;
}

interface Commit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      email: string;
      date: string;
    };
  };
}

async function fetchGitHub<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "ingestion-worker",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status}`);
  }
  return res.json();
}

async function syncUser(db: D1Database, username: string, token: string): Promise<User> {
  const user = await fetchGitHub<User>(`/users/${username}`, token);

  await db
    .prepare(
      `INSERT INTO github_users (id, login, name, avatar_url, synced_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         login = excluded.login,
         name = excluded.name,
         avatar_url = excluded.avatar_url,
         synced_at = excluded.synced_at`
    )
    .bind(user.id, user.login, user.name, user.avatar_url)
    .run();

  return user;
}

async function syncRepos(
  db: D1Database,
  username: string,
  userId: number,
  token: string
): Promise<Repo[]> {
  const repos = await fetchGitHub<Repo[]>(
    `/users/${username}/repos?per_page=100&sort=pushed`,
    token
  );

  for (const repo of repos) {
    await db
      .prepare(
        `INSERT INTO github_repos (id, owner_id, name, full_name, description, language, stars, forks, is_private, default_branch, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           full_name = excluded.full_name,
           description = excluded.description,
           language = excluded.language,
           stars = excluded.stars,
           forks = excluded.forks,
           is_private = excluded.is_private,
           default_branch = excluded.default_branch,
           synced_at = excluded.synced_at`
      )
      .bind(
        repo.id,
        userId,
        repo.name,
        repo.full_name,
        repo.description,
        repo.language,
        repo.stargazers_count,
        repo.forks_count,
        repo.private ? 1 : 0,
        repo.default_branch
      )
      .run();
  }

  return repos;
}

async function syncCommits(db: D1Database, repo: Repo, token: string): Promise<number> {
  const commits = await fetchGitHub<Commit[]>(
    `/repos/${repo.full_name}/commits?per_page=100`,
    token
  );

  let synced = 0;
  for (const commit of commits) {
    const message = commit.commit.message.substring(0, 500);
    try {
      await db
        .prepare(
          `INSERT INTO github_commits (sha, repo_id, message, author_name, author_email, author_date, additions, deletions, files_changed, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, datetime('now'))
           ON CONFLICT(sha) DO NOTHING`
        )
        .bind(
          commit.sha,
          repo.id,
          message,
          commit.commit.author.name,
          commit.commit.author.email,
          commit.commit.author.date
        )
        .run();
      synced++;
    } catch {
      // ignore duplicate
    }
  }

  return synced;
}

export async function runSync(env: Env): Promise<SyncResult> {
  const { DB: db, GITHUB_TOKEN: token, GITHUB_USERNAME: username } = env;

  const user = await syncUser(db, username, token);
  const repos = await syncRepos(db, username, user.id, token);

  let totalCommits = 0;
  for (const repo of repos.filter((r) => !r.private)) {
    try {
      const count = await syncCommits(db, repo, token);
      totalCommits += count;
    } catch (e) {
      console.error(`Failed to sync commits for ${repo.name}:`, e);
    }
  }

  return {
    service: "github",
    success: true,
    message: `Synced ${repos.length} repos, ${totalCommits} commits`,
    count: totalCommits,
  };
}

// Routes
app.post("/sync", async (c) => {
  const result = await runSync(c.env);
  return c.json(result);
});

app.get("/stats", async (c) => {
  const stats = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM github_repos) as repos,
       (SELECT COUNT(*) FROM github_commits) as commits,
       (SELECT MAX(synced_at) FROM github_commits) as last_sync`
  ).first();
  return c.json(stats);
});

app.get("/daily", async (c) => {
  const results = await c.env.DB.prepare(
    "SELECT * FROM v_daily_commits LIMIT 30"
  ).all();
  return c.json(results.results);
});

app.get("/repos", async (c) => {
  const results = await c.env.DB.prepare(
    "SELECT * FROM v_repo_stats LIMIT 50"
  ).all();
  return c.json(results.results);
});

export default app;
