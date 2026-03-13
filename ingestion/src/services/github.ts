import { Hono } from "hono";
import type { Env, SyncResult } from "../types";
import {
  encodeGitHubCommit,
  encodeGitHubRepo,
  encodeGitHubUser,
  type GitHubCommitRow,
  type GitHubRepoRow,
  type GitHubUserRow,
} from "./parquet";

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

function groupByDay(commits: GitHubCommitRow[]): Map<string, GitHubCommitRow[]> {
  const map = new Map<string, GitHubCommitRow[]>();
  for (const commit of commits) {
    const arr = map.get(commit.day) ?? [];
    arr.push(commit);
    map.set(commit.day, arr);
  }
  return map;
}

export async function runSync(env: Env): Promise<SyncResult> {
  const {
    GITHUB_TOKEN: token,
    GITHUB_USERNAME: username,
    DATA_LAKE: r2,
    PARQUET_ENCODER: encoder,
  } = env;

  const synced_at = new Date().toISOString();

  // 1. Fetch & write user
  const user = await fetchGitHub<User>(`/users/${username}`, token);
  const userRows: GitHubUserRow[] = [
    {
      id: user.id,
      login: user.login,
      name: user.name,
      avatar_url: user.avatar_url,
      synced_at,
    },
  ];
  const userParquet = await encodeGitHubUser(encoder, userRows);
  await r2.put("github/users.parquet", userParquet);

  // 2. Fetch & write repos
  const repos = await fetchGitHub<Repo[]>(
    `/users/${username}/repos?per_page=100&sort=pushed`,
    token
  );
  const repoRows: GitHubRepoRow[] = repos.map((repo) => ({
    id: repo.id,
    owner_id: user.id,
    name: repo.name,
    full_name: repo.full_name,
    description: repo.description,
    language: repo.language,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    is_private: repo.private ? 1 : 0,
    default_branch: repo.default_branch,
    synced_at,
  }));
  const repoParquet = await encodeGitHubRepo(encoder, repoRows);
  await r2.put("github/repos.parquet", repoParquet);

  // 3. Fetch commits from ALL public repos, then group by day
  const allCommitRows: GitHubCommitRow[] = [];
  for (const repo of repos.filter((r) => !r.private)) {
    try {
      const commits = await fetchGitHub<Commit[]>(
        `/repos/${repo.full_name}/commits?per_page=100`,
        token
      );
      for (const commit of commits) {
        const authorDate = commit.commit.author.date;
        const day = authorDate.split("T")[0];
        allCommitRows.push({
          sha: commit.sha,
          repo_id: repo.id,
          repo_full_name: repo.full_name,
          message: commit.commit.message.substring(0, 500),
          author_name: commit.commit.author.name,
          author_email: commit.commit.author.email,
          author_date: authorDate,
          day,
          synced_at,
        });
      }
    } catch (e) {
      console.error(`Failed to fetch commits for ${repo.name}:`, e);
    }
  }

  // Write daily Parquet files (all repos combined per day)
  const grouped = groupByDay(allCommitRows);
  for (const [day, rows] of grouped) {
    const parquet = await encodeGitHubCommit(encoder, rows);
    await r2.put(`github/commits/${day}.parquet`, parquet);
  }

  return {
    service: "github",
    success: true,
    message: `Synced ${repos.length} repos, ${allCommitRows.length} commits to R2 Parquet`,
    count: allCommitRows.length,
  };
}

// Routes
app.post("/sync", async (c) => {
  const result = await runSync(c.env);
  return c.json(result);
});

app.get("/stats", async (c) => {
  const r2 = c.env.DATA_LAKE;
  const counts: Record<string, number> = { users: 0, repos: 0, commits: 0 };

  for (const [name, prefix] of Object.entries({
    users: "github/users",
    repos: "github/repos",
    commits: "github/commits/",
  })) {
    let cursor: string | undefined;
    do {
      const list = await r2.list({ prefix, cursor });
      counts[name] += list.objects.length;
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
  }

  const stats = {
    users_files: counts.users,
    repos_files: counts.repos,
    commits_files: counts.commits,
  };

  return c.json(stats);
});

export default app;
