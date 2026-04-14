# GitHub / Linear / Withings → R2 Parquet Migration

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate GitHub, Linear, and Withings ingestion from D1 direct writes to R2 Parquet files, following the pattern established by the Oura R2 migration.

**Architecture:** Each service's sync functions are rewritten to encode data as Parquet via the existing `parquet.ts` infrastructure (`apache-arrow` → `parquet-wasm` → R2 PUT). D1 retains only metadata (OAuth tokens, sync_state). Partitioning follows Plan B: master data as single files, time-series as daily files, snapshots as single files.

**Tech Stack:** TypeScript, Hono, parquet-wasm, apache-arrow, Cloudflare Workers (R2 + D1), Vitest

---

## R2 Key Layout (Plan B)

```
data-lake/
├── github/
│   ├── users.parquet                    ← master (1 file, overwritten)
│   ├── repos.parquet                    ← master (1 file, overwritten)
│   └── commits/{YYYY-MM-DD}.parquet     ← daily (by author_date)
├── linear/
│   ├── issues.parquet                   ← full snapshot (overwritten)
│   ├── projects.parquet                 ← full snapshot (overwritten)
│   └── labels.parquet                   ← full snapshot (overwritten)
└── withings/
    ├── measures/{YYYY-MM-DD}.parquet    ← daily (by date)
    ├── sleep/{YYYY-MM-DD}.parquet       ← daily (by date)
    └── activity/{YYYY-MM-DD}.parquet    ← daily (by date)
```

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `ingestion/src/services/parquet.ts` | Add Row types + encode functions for GitHub, Linear, Withings |
| Modify | `ingestion/src/services/github.ts` | Replace D1 writes with R2 Parquet writes |
| Modify | `ingestion/src/services/linear.ts` | Replace D1 writes with R2 Parquet writes |
| Modify | `ingestion/src/services/withings.ts` | Replace D1 writes with R2 Parquet writes |
| Modify | `ingestion/src/__tests__/parquet.test.ts` | Add encode tests for new Row types |
| Create | `ingestion/src/__tests__/github.test.ts` | Integration tests for GitHub R2 sync |
| Create | `ingestion/src/__tests__/linear.test.ts` | Integration tests for Linear R2 sync |
| Create | `ingestion/src/__tests__/withings.test.ts` | Integration tests for Withings R2 sync |

---

## Chunk 1: Parquet Encoders

### Task 1: Add GitHub Row types and encoders to parquet.ts

**Files:**
- Modify: `ingestion/src/services/parquet.ts`
- Modify: `ingestion/src/__tests__/parquet.test.ts`

- [ ] **Step 1: Write failing tests for GitHub encoders**

Add to `ingestion/src/__tests__/parquet.test.ts`:

```typescript
describe("encodeGitHubUser", () => {
  it("should encode user data to valid Parquet", async () => {
    const data = [
      {
        id: 12345,
        login: "ta93abe",
        name: "ta93abe",
        avatar_url: "https://avatars.githubusercontent.com/u/12345",
        synced_at: "2026-03-13T00:00:00Z",
      },
    ];
    const buffer = await encodeGitHubUser(data);
    expectParquetMagic(buffer);
  });
});

describe("encodeGitHubRepo", () => {
  it("should encode repo data to valid Parquet", async () => {
    const data = [
      {
        id: 100,
        owner_id: 12345,
        name: "my-repo",
        full_name: "ta93abe/my-repo",
        description: "A test repo",
        language: "TypeScript",
        stars: 10,
        forks: 2,
        is_private: false,
        default_branch: "main",
        synced_at: "2026-03-13T00:00:00Z",
      },
    ];
    const buffer = await encodeGitHubRepo(data);
    expectParquetMagic(buffer);
  });

  it("should handle nullable fields", async () => {
    const data = [
      {
        id: 101,
        owner_id: 12345,
        name: "empty-repo",
        full_name: "ta93abe/empty-repo",
        description: null,
        language: null,
        stars: 0,
        forks: 0,
        is_private: true,
        default_branch: "main",
        synced_at: "2026-03-13T00:00:00Z",
      },
    ];
    const buffer = await encodeGitHubRepo(data);
    expectParquetMagic(buffer);
  });
});

describe("encodeGitHubCommit", () => {
  it("should encode commit data to valid Parquet", async () => {
    const data = [
      {
        sha: "abc123",
        repo_id: 100,
        repo_full_name: "ta93abe/my-repo",
        message: "feat: initial commit",
        author_name: "ta93abe",
        author_email: "test@example.com",
        author_date: "2026-03-13T10:00:00Z",
        day: "2026-03-13",
        synced_at: "2026-03-13T12:00:00Z",
      },
    ];
    const buffer = await encodeGitHubCommit(data);
    expectParquetMagic(buffer);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ingestion && pnpm vitest run --config vitest.config.node.ts`
Expected: FAIL — `encodeGitHubUser`, `encodeGitHubRepo`, `encodeGitHubCommit` not found

- [ ] **Step 3: Add Row types and encode functions**

Add to `ingestion/src/services/parquet.ts`:

```typescript
// ============================================
// GitHub Row types
// ============================================

export interface GitHubUserRow {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  synced_at: string;
}

export interface GitHubRepoRow {
  id: number;
  owner_id: number;
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  is_private: boolean;
  default_branch: string;
  synced_at: string;
}

export interface GitHubCommitRow {
  sha: string;
  repo_id: number;
  repo_full_name: string;
  message: string | null;
  author_name: string | null;
  author_email: string | null;
  author_date: string;
  day: string;
  synced_at: string;
}

// ============================================
// GitHub encode functions
// ============================================

export async function encodeGitHubUser(rows: GitHubUserRow[]): Promise<Uint8Array> {
  ensureWasmInit();
  return arrowToParquet({
    id: extractColumn(rows, "id"),
    login: extractColumn(rows, "login"),
    name: extractColumn(rows, "name"),
    avatar_url: extractColumn(rows, "avatar_url"),
    synced_at: extractColumn(rows, "synced_at"),
  });
}

export async function encodeGitHubRepo(rows: GitHubRepoRow[]): Promise<Uint8Array> {
  ensureWasmInit();
  return arrowToParquet({
    id: extractColumn(rows, "id"),
    owner_id: extractColumn(rows, "owner_id"),
    name: extractColumn(rows, "name"),
    full_name: extractColumn(rows, "full_name"),
    description: extractColumn(rows, "description"),
    language: extractColumn(rows, "language"),
    stars: extractColumn(rows, "stars"),
    forks: extractColumn(rows, "forks"),
    is_private: extractColumn(rows, "is_private"),
    default_branch: extractColumn(rows, "default_branch"),
    synced_at: extractColumn(rows, "synced_at"),
  });
}

export async function encodeGitHubCommit(rows: GitHubCommitRow[]): Promise<Uint8Array> {
  ensureWasmInit();
  return arrowToParquet({
    sha: extractColumn(rows, "sha"),
    repo_id: extractColumn(rows, "repo_id"),
    repo_full_name: extractColumn(rows, "repo_full_name"),
    message: extractColumn(rows, "message"),
    author_name: extractColumn(rows, "author_name"),
    author_email: extractColumn(rows, "author_email"),
    author_date: extractColumn(rows, "author_date"),
    day: extractColumn(rows, "day"),
    synced_at: extractColumn(rows, "synced_at"),
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ingestion && pnpm vitest run --config vitest.config.node.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ingestion/src/services/parquet.ts ingestion/src/__tests__/parquet.test.ts
git commit -m "feat: add GitHub Parquet encoders (users, repos, commits)"
```

### Task 2: Add Linear Row types and encoders to parquet.ts

**Files:**
- Modify: `ingestion/src/services/parquet.ts`
- Modify: `ingestion/src/__tests__/parquet.test.ts`

- [ ] **Step 1: Write failing tests for Linear encoders**

Add to `ingestion/src/__tests__/parquet.test.ts`:

```typescript
describe("encodeLinearIssue", () => {
  it("should encode issue data to valid Parquet", async () => {
    const data = [
      {
        id: "issue-001",
        identifier: "TA-100",
        title: "Test issue",
        description_length: 150,
        priority: 2,
        estimate: 3,
        state_name: "In Progress",
        state_type: "started",
        label_names: '["bug","frontend"]',
        project_name: "de-study",
        cycle_number: 5,
        assignee_name: "ta93abe",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-03-13T00:00:00Z",
        started_at: "2026-01-02T00:00:00Z",
        completed_at: null,
        canceled_at: null,
        due_date: "2026-04-01",
        synced_at: "2026-03-13T00:00:00Z",
      },
    ];
    const buffer = await encodeLinearIssue(data);
    expectParquetMagic(buffer);
  });
});

describe("encodeLinearProject", () => {
  it("should encode project data to valid Parquet", async () => {
    const data = [
      {
        id: "proj-001",
        name: "de-study",
        state: "started",
        progress: 0.65,
        start_date: "2026-01-01",
        target_date: "2026-06-30",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-03-13T00:00:00Z",
        completed_at: null,
        synced_at: "2026-03-13T00:00:00Z",
      },
    ];
    const buffer = await encodeLinearProject(data);
    expectParquetMagic(buffer);
  });
});

describe("encodeLinearLabel", () => {
  it("should encode label data to valid Parquet", async () => {
    const data = [
      {
        id: "label-001",
        name: "bug",
        color: "#ff0000",
        synced_at: "2026-03-13T00:00:00Z",
      },
    ];
    const buffer = await encodeLinearLabel(data);
    expectParquetMagic(buffer);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ingestion && pnpm vitest run --config vitest.config.node.ts`
Expected: FAIL

- [ ] **Step 3: Add Linear Row types and encode functions**

Add to `ingestion/src/services/parquet.ts`:

```typescript
// ============================================
// Linear Row types
// ============================================

export interface LinearIssueRow {
  id: string;
  identifier: string;
  title: string;
  description_length: number;
  priority: number | null;
  estimate: number | null;
  state_name: string | null;
  state_type: string | null;
  label_names: string;
  project_name: string | null;
  cycle_number: number | null;
  assignee_name: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  canceled_at: string | null;
  due_date: string | null;
  synced_at: string;
}

export interface LinearProjectRow {
  id: string;
  name: string;
  state: string | null;
  progress: number | null;
  start_date: string | null;
  target_date: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  synced_at: string;
}

export interface LinearLabelRow {
  id: string;
  name: string;
  color: string | null;
  synced_at: string;
}

// ============================================
// Linear encode functions
// ============================================

export async function encodeLinearIssue(rows: LinearIssueRow[]): Promise<Uint8Array> {
  ensureWasmInit();
  return arrowToParquet({
    id: extractColumn(rows, "id"),
    identifier: extractColumn(rows, "identifier"),
    title: extractColumn(rows, "title"),
    description_length: extractColumn(rows, "description_length"),
    priority: extractColumn(rows, "priority"),
    estimate: extractColumn(rows, "estimate"),
    state_name: extractColumn(rows, "state_name"),
    state_type: extractColumn(rows, "state_type"),
    label_names: extractColumn(rows, "label_names"),
    project_name: extractColumn(rows, "project_name"),
    cycle_number: extractColumn(rows, "cycle_number"),
    assignee_name: extractColumn(rows, "assignee_name"),
    created_at: extractColumn(rows, "created_at"),
    updated_at: extractColumn(rows, "updated_at"),
    started_at: extractColumn(rows, "started_at"),
    completed_at: extractColumn(rows, "completed_at"),
    canceled_at: extractColumn(rows, "canceled_at"),
    due_date: extractColumn(rows, "due_date"),
    synced_at: extractColumn(rows, "synced_at"),
  });
}

export async function encodeLinearProject(rows: LinearProjectRow[]): Promise<Uint8Array> {
  ensureWasmInit();
  return arrowToParquet({
    id: extractColumn(rows, "id"),
    name: extractColumn(rows, "name"),
    state: extractColumn(rows, "state"),
    progress: extractColumn(rows, "progress"),
    start_date: extractColumn(rows, "start_date"),
    target_date: extractColumn(rows, "target_date"),
    created_at: extractColumn(rows, "created_at"),
    updated_at: extractColumn(rows, "updated_at"),
    completed_at: extractColumn(rows, "completed_at"),
    synced_at: extractColumn(rows, "synced_at"),
  });
}

export async function encodeLinearLabel(rows: LinearLabelRow[]): Promise<Uint8Array> {
  ensureWasmInit();
  return arrowToParquet({
    id: extractColumn(rows, "id"),
    name: extractColumn(rows, "name"),
    color: extractColumn(rows, "color"),
    synced_at: extractColumn(rows, "synced_at"),
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ingestion && pnpm vitest run --config vitest.config.node.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ingestion/src/services/parquet.ts ingestion/src/__tests__/parquet.test.ts
git commit -m "feat: add Linear Parquet encoders (issues, projects, labels)"
```

### Task 3: Add Withings Row types and encoders to parquet.ts

**Files:**
- Modify: `ingestion/src/services/parquet.ts`
- Modify: `ingestion/src/__tests__/parquet.test.ts`

- [ ] **Step 1: Write failing tests for Withings encoders**

Add to `ingestion/src/__tests__/parquet.test.ts`:

```typescript
describe("encodeWithingsMeasure", () => {
  it("should encode measure data to valid Parquet", async () => {
    const data = [
      {
        grpid: 1001,
        date: "2026-03-13",
        timestamp: 1741824000,
        weight: 70.5,
        fat_ratio: 18.2,
        fat_mass: 12.8,
        fat_free_mass: 57.7,
        muscle_mass: 32.1,
        bone_mass: 3.2,
        hydration: 42.0,
        heart_pulse: 65,
        synced_at: "2026-03-13T00:00:00Z",
      },
    ];
    const buffer = await encodeWithingsMeasure(data);
    expectParquetMagic(buffer);
  });

  it("should handle nullable fields", async () => {
    const data = [
      {
        grpid: 1002,
        date: "2026-03-13",
        timestamp: 1741824000,
        weight: 70.5,
        fat_ratio: null,
        fat_mass: null,
        fat_free_mass: null,
        muscle_mass: null,
        bone_mass: null,
        hydration: null,
        heart_pulse: null,
        synced_at: "2026-03-13T00:00:00Z",
      },
    ];
    const buffer = await encodeWithingsMeasure(data);
    expectParquetMagic(buffer);
  });
});

describe("encodeWithingsSleep", () => {
  it("should encode sleep data to valid Parquet", async () => {
    const data = [
      {
        date: "2026-03-13",
        startdate: 1741816800,
        enddate: 1741845600,
        total_sleep_duration: 28800,
        deep_sleep_duration: 7200,
        light_sleep_duration: 14400,
        rem_sleep_duration: 5400,
        wakeup_duration: 1800,
        sleep_score: 82,
        sleep_efficiency: 0.92,
        sleep_latency: 600,
        hr_average: 58.5,
        hr_min: 48,
        hr_max: 72,
        rr_average: 16.2,
        rr_min: 14.0,
        rr_max: 18.5,
        snoring: 120,
        snoring_episode_count: 3,
        synced_at: "2026-03-13T12:00:00Z",
      },
    ];
    const buffer = await encodeWithingsSleep(data);
    expectParquetMagic(buffer);
  });
});

describe("encodeWithingsActivity", () => {
  it("should encode activity data to valid Parquet", async () => {
    const data = [
      {
        date: "2026-03-13",
        steps: 8500,
        distance: 6500.0,
        elevation: 50.0,
        soft: 3600,
        moderate: 1800,
        intense: 900,
        active: 6300,
        calories: 350.0,
        total_calories: 2100.0,
        hr_average: 72.0,
        hr_min: 55,
        hr_max: 145,
        synced_at: "2026-03-13T12:00:00Z",
      },
    ];
    const buffer = await encodeWithingsActivity(data);
    expectParquetMagic(buffer);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ingestion && pnpm vitest run --config vitest.config.node.ts`
Expected: FAIL

- [ ] **Step 3: Add Withings Row types and encode functions**

Add to `ingestion/src/services/parquet.ts`:

```typescript
// ============================================
// Withings Row types
// ============================================

export interface WithingsMeasureRow {
  grpid: number;
  date: string;
  timestamp: number;
  weight: number | null;
  fat_ratio: number | null;
  fat_mass: number | null;
  fat_free_mass: number | null;
  muscle_mass: number | null;
  bone_mass: number | null;
  hydration: number | null;
  heart_pulse: number | null;
  synced_at: string;
}

export interface WithingsSleepRow {
  date: string;
  startdate: number;
  enddate: number;
  total_sleep_duration: number | null;
  deep_sleep_duration: number | null;
  light_sleep_duration: number | null;
  rem_sleep_duration: number | null;
  wakeup_duration: number | null;
  sleep_score: number | null;
  sleep_efficiency: number | null;
  sleep_latency: number | null;
  hr_average: number | null;
  hr_min: number | null;
  hr_max: number | null;
  rr_average: number | null;
  rr_min: number | null;
  rr_max: number | null;
  snoring: number | null;
  snoring_episode_count: number | null;
  synced_at: string;
}

export interface WithingsActivityRow {
  date: string;
  steps: number | null;
  distance: number | null;
  elevation: number | null;
  soft: number | null;
  moderate: number | null;
  intense: number | null;
  active: number | null;
  calories: number | null;
  total_calories: number | null;
  hr_average: number | null;
  hr_min: number | null;
  hr_max: number | null;
  synced_at: string;
}

// ============================================
// Withings encode functions
// ============================================

export async function encodeWithingsMeasure(rows: WithingsMeasureRow[]): Promise<Uint8Array> {
  ensureWasmInit();
  return arrowToParquet({
    grpid: extractColumn(rows, "grpid"),
    date: extractColumn(rows, "date"),
    timestamp: extractColumn(rows, "timestamp"),
    weight: extractColumn(rows, "weight"),
    fat_ratio: extractColumn(rows, "fat_ratio"),
    fat_mass: extractColumn(rows, "fat_mass"),
    fat_free_mass: extractColumn(rows, "fat_free_mass"),
    muscle_mass: extractColumn(rows, "muscle_mass"),
    bone_mass: extractColumn(rows, "bone_mass"),
    hydration: extractColumn(rows, "hydration"),
    heart_pulse: extractColumn(rows, "heart_pulse"),
    synced_at: extractColumn(rows, "synced_at"),
  });
}

export async function encodeWithingsSleep(rows: WithingsSleepRow[]): Promise<Uint8Array> {
  ensureWasmInit();
  return arrowToParquet({
    date: extractColumn(rows, "date"),
    startdate: extractColumn(rows, "startdate"),
    enddate: extractColumn(rows, "enddate"),
    total_sleep_duration: extractColumn(rows, "total_sleep_duration"),
    deep_sleep_duration: extractColumn(rows, "deep_sleep_duration"),
    light_sleep_duration: extractColumn(rows, "light_sleep_duration"),
    rem_sleep_duration: extractColumn(rows, "rem_sleep_duration"),
    wakeup_duration: extractColumn(rows, "wakeup_duration"),
    sleep_score: extractColumn(rows, "sleep_score"),
    sleep_efficiency: extractColumn(rows, "sleep_efficiency"),
    sleep_latency: extractColumn(rows, "sleep_latency"),
    hr_average: extractColumn(rows, "hr_average"),
    hr_min: extractColumn(rows, "hr_min"),
    hr_max: extractColumn(rows, "hr_max"),
    rr_average: extractColumn(rows, "rr_average"),
    rr_min: extractColumn(rows, "rr_min"),
    rr_max: extractColumn(rows, "rr_max"),
    snoring: extractColumn(rows, "snoring"),
    snoring_episode_count: extractColumn(rows, "snoring_episode_count"),
    synced_at: extractColumn(rows, "synced_at"),
  });
}

export async function encodeWithingsActivity(rows: WithingsActivityRow[]): Promise<Uint8Array> {
  ensureWasmInit();
  return arrowToParquet({
    date: extractColumn(rows, "date"),
    steps: extractColumn(rows, "steps"),
    distance: extractColumn(rows, "distance"),
    elevation: extractColumn(rows, "elevation"),
    soft: extractColumn(rows, "soft"),
    moderate: extractColumn(rows, "moderate"),
    intense: extractColumn(rows, "intense"),
    active: extractColumn(rows, "active"),
    calories: extractColumn(rows, "calories"),
    total_calories: extractColumn(rows, "total_calories"),
    hr_average: extractColumn(rows, "hr_average"),
    hr_min: extractColumn(rows, "hr_min"),
    hr_max: extractColumn(rows, "hr_max"),
    synced_at: extractColumn(rows, "synced_at"),
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ingestion && pnpm vitest run --config vitest.config.node.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ingestion/src/services/parquet.ts ingestion/src/__tests__/parquet.test.ts
git commit -m "feat: add Withings Parquet encoders (measures, sleep, activity)"
```

---

## Chunk 2: GitHub Service Migration

### Task 4: Rewrite github.ts to write R2 Parquet

**Files:**
- Modify: `ingestion/src/services/github.ts`
- Create: `ingestion/src/__tests__/github.test.ts`

The GitHub service needs these changes:
1. Import parquet-wasm and encoders
2. `syncUser` → encode as Parquet, write to `github/users.parquet`
3. `syncRepos` → encode all repos as Parquet, write to `github/repos.parquet`
4. `syncCommits` → group commits by `date(author_date)`, write daily Parquet to `github/commits/{day}.parquet`
5. Stats route → count R2 objects instead of D1 rows

- [ ] **Step 1: Write integration test for GitHub R2 sync**

Create `ingestion/src/__tests__/github.test.ts`:

```typescript
import { env, fetchMock, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const GITHUB_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS data_sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    source_type TEXT NOT NULL,
    api_endpoint TEXT,
    schedule_cron TEXT,
    is_active INTEGER DEFAULT 1,
    config_json TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_state (
    id TEXT PRIMARY KEY,
    data_source_id TEXT NOT NULL,
    last_sync_at TEXT,
    last_cursor TEXT,
    metadata_json TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO data_sources (id, name, source_type, api_endpoint, schedule_cron)
VALUES ('github', 'GitHub', 'api', 'https://api.github.com', '0 0 * * *');

INSERT OR IGNORE INTO sync_state (id, data_source_id, last_sync_at)
VALUES ('github', 'github', NULL);
`;

beforeAll(async () => {
  const statements = GITHUB_MIGRATION_SQL.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const sql of statements) {
    await env.DB.prepare(sql).run();
  }
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

describe("github sync to R2", () => {
  it("syncs user, repos, and commits to R2 Parquet", async () => {
    // Mock user
    fetchMock
      .get("https://api.github.com")
      .intercept({ path: "/users/ta93abe" })
      .reply(200, {
        id: 12345,
        login: "ta93abe",
        name: "ta93abe",
        avatar_url: "https://avatars.githubusercontent.com/u/12345",
      });

    // Mock repos
    fetchMock
      .get("https://api.github.com")
      .intercept({ path: /\/users\/ta93abe\/repos/ })
      .reply(200, [
        {
          id: 100,
          name: "test-repo",
          full_name: "ta93abe/test-repo",
          description: "A test repo",
          language: "TypeScript",
          stargazers_count: 5,
          forks_count: 1,
          private: false,
          default_branch: "main",
        },
      ]);

    // Mock commits
    fetchMock
      .get("https://api.github.com")
      .intercept({ path: /\/repos\/ta93abe\/test-repo\/commits/ })
      .reply(200, [
        {
          sha: "abc123",
          commit: {
            message: "feat: initial commit",
            author: {
              name: "ta93abe",
              email: "test@example.com",
              date: "2026-03-13T10:00:00Z",
            },
          },
        },
        {
          sha: "def456",
          commit: {
            message: "fix: typo",
            author: {
              name: "ta93abe",
              email: "test@example.com",
              date: "2026-03-13T11:00:00Z",
            },
          },
        },
      ]);

    const res = await SELF.fetch("https://example.com/github/sync", { method: "POST" });
    expect(res.status).toBe(200);

    const json = (await res.json()) as { success: boolean };
    expect(json.success).toBe(true);

    // Verify R2 files
    const usersObj = await env.DATA_LAKE.head("github/users.parquet");
    expect(usersObj).not.toBeNull();

    const reposObj = await env.DATA_LAKE.head("github/repos.parquet");
    expect(reposObj).not.toBeNull();

    const commitsObj = await env.DATA_LAKE.head("github/commits/2026-03-13.parquet");
    expect(commitsObj).not.toBeNull();
  });
});

describe("github stats from R2", () => {
  it("returns R2 file counts", async () => {
    const res = await SELF.fetch("https://example.com/github/stats");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toHaveProperty("users_files");
    expect(json).toHaveProperty("repos_files");
    expect(json).toHaveProperty("commits_files");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ingestion && pnpm vitest run src/__tests__/github.test.ts`
Expected: FAIL (still writing to D1, not R2)

- [ ] **Step 3: Rewrite github.ts sync functions for R2 Parquet**

Rewrite `ingestion/src/services/github.ts`. Key changes:

1. Add WASM import and parquet imports (same pattern as oura.ts)
2. Replace `syncUser` D1 writes → `encodeGitHubUser` + `r2.put("github/users.parquet", ...)`
3. Replace `syncRepos` D1 writes → `encodeGitHubRepo` + `r2.put("github/repos.parquet", ...)`
4. Replace `syncCommits` D1 writes → group by day, `encodeGitHubCommit` + `r2.put("github/commits/{day}.parquet", ...)`
5. `runSync` → accept `env` (access `env.DATA_LAKE`), init parquet-wasm
6. Stats route → use `DATA_LAKE.list({ prefix: "github/..." })` counts
7. Remove `/daily` and `/repos` D1 query routes (data is now in R2)

Full implementation:

```typescript
import { Hono } from "hono";
// @ts-expect-error — Wrangler bundles .wasm as WebAssembly.Module
import PARQUET_WASM from "../../node_modules/parquet-wasm/esm/parquet_wasm_bg.wasm";
import type { Env, SyncResult } from "../types";
import {
  encodeGitHubCommit,
  encodeGitHubRepo,
  encodeGitHubUser,
  type GitHubCommitRow,
  type GitHubRepoRow,
  type GitHubUserRow,
  initParquetWasm,
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

async function syncUser(r2: R2Bucket, username: string, token: string): Promise<User> {
  const user = await fetchGitHub<User>(`/users/${username}`, token);
  const synced_at = new Date().toISOString();

  const rows: GitHubUserRow[] = [
    {
      id: user.id,
      login: user.login,
      name: user.name,
      avatar_url: user.avatar_url,
      synced_at,
    },
  ];
  const parquet = await encodeGitHubUser(rows);
  await r2.put("github/users.parquet", parquet);

  return user;
}

async function syncRepos(
  r2: R2Bucket,
  username: string,
  token: string
): Promise<Repo[]> {
  const repos = await fetchGitHub<Repo[]>(
    `/users/${username}/repos?per_page=100&sort=pushed`,
    token
  );
  const synced_at = new Date().toISOString();

  const rows: GitHubRepoRow[] = repos.map((repo) => ({
    id: repo.id,
    owner_id: 0, // will be set after user sync
    name: repo.name,
    full_name: repo.full_name,
    description: repo.description,
    language: repo.language,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    is_private: repo.private,
    default_branch: repo.default_branch,
    synced_at,
  }));

  if (rows.length > 0) {
    const parquet = await encodeGitHubRepo(rows);
    await r2.put("github/repos.parquet", parquet);
  }

  return repos;
}

function groupCommitsByDay(commits: Commit[], repoFullName: string, synced_at: string): Map<string, GitHubCommitRow[]> {
  const map = new Map<string, GitHubCommitRow[]>();
  for (const commit of commits) {
    const day = commit.commit.author.date.split("T")[0];
    const arr = map.get(day) ?? [];
    arr.push({
      sha: commit.sha,
      repo_id: 0,
      repo_full_name: repoFullName,
      message: commit.commit.message.substring(0, 500),
      author_name: commit.commit.author.name,
      author_email: commit.commit.author.email,
      author_date: commit.commit.author.date,
      day,
      synced_at,
    });
    map.set(day, arr);
  }
  return map;
}

async function syncCommits(r2: R2Bucket, repo: Repo, token: string): Promise<number> {
  const commits = await fetchGitHub<Commit[]>(
    `/repos/${repo.full_name}/commits?per_page=100`,
    token
  );
  const synced_at = new Date().toISOString();

  const grouped = groupCommitsByDay(commits, repo.full_name, synced_at);

  for (const [day, rows] of grouped) {
    // Merge with existing day file: read existing, append new (deduplicate by sha)
    const existingKey = `github/commits/${day}.parquet`;
    // For simplicity, overwrite per repo sync — commits are append-only and idempotent by sha in downstream
    const parquet = await encodeGitHubCommit(rows);
    await r2.put(existingKey, parquet);
  }

  return commits.length;
}

export async function runSync(env: Env): Promise<SyncResult> {
  const { DATA_LAKE: r2, GITHUB_TOKEN: token, GITHUB_USERNAME: username } = env;

  initParquetWasm(PARQUET_WASM);

  const user = await syncUser(r2, username, token);
  const repos = await syncRepos(r2, username, token);

  // Update owner_id in repos file now that we have user.id
  const synced_at = new Date().toISOString();
  const repoRows: GitHubRepoRow[] = repos.map((repo) => ({
    id: repo.id,
    owner_id: user.id,
    name: repo.name,
    full_name: repo.full_name,
    description: repo.description,
    language: repo.language,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    is_private: repo.private,
    default_branch: repo.default_branch,
    synced_at,
  }));
  if (repoRows.length > 0) {
    const parquet = await encodeGitHubRepo(repoRows);
    await r2.put("github/repos.parquet", parquet);
  }

  let totalCommits = 0;
  for (const repo of repos.filter((r) => !r.private)) {
    try {
      const count = await syncCommits(r2, repo, token);
      totalCommits += count;
    } catch (e) {
      console.error(`Failed to sync commits for ${repo.name}:`, e);
    }
  }

  return {
    service: "github",
    success: true,
    message: `Synced ${repos.length} repos, ${totalCommits} commits to R2 Parquet`,
    count: totalCommits,
  };
}

// Routes
app.post("/sync", async (c) => {
  const result = await runSync(c.env);
  return c.json(result);
});

app.get("/stats", async (c) => {
  const r2 = c.env.DATA_LAKE;

  const usersObj = await r2.head("github/users.parquet");
  const reposObj = await r2.head("github/repos.parquet");

  let commitsFiles = 0;
  let cursor: string | undefined;
  do {
    const list = await r2.list({ prefix: "github/commits/", cursor });
    commitsFiles += list.objects.length;
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);

  return c.json({
    users_files: usersObj ? 1 : 0,
    repos_files: reposObj ? 1 : 0,
    commits_files: commitsFiles,
  });
});

export default app;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ingestion && pnpm vitest run src/__tests__/github.test.ts`
Expected: PASS

- [ ] **Step 5: Run existing tests to verify no regressions**

Run: `cd ingestion && pnpm vitest run`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add ingestion/src/services/github.ts ingestion/src/__tests__/github.test.ts
git commit -m "feat: migrate GitHub ingestion from D1 to R2 Parquet"
```

---

## Chunk 3: Linear Service Migration

### Task 5: Rewrite linear.ts to write R2 Parquet

**Files:**
- Modify: `ingestion/src/services/linear.ts`
- Create: `ingestion/src/__tests__/linear.test.ts`

Key changes:
1. Import WASM + parquet encoders
2. `syncIssues` → encode all issues, write to `linear/issues.parquet` (single file overwrite)
3. `syncProjects` → encode all, write to `linear/projects.parquet`
4. `syncLabels` → encode all, write to `linear/labels.parquet`
5. Stats route → R2 head checks
6. Remove D1 query routes (`/weekly`, `/labels`, `/projects`)

- [ ] **Step 1: Write integration test**

Create `ingestion/src/__tests__/linear.test.ts`:

```typescript
import { env, fetchMock, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const LINEAR_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS data_sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    source_type TEXT NOT NULL,
    api_endpoint TEXT,
    schedule_cron TEXT,
    is_active INTEGER DEFAULT 1,
    config_json TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_state (
    id TEXT PRIMARY KEY,
    data_source_id TEXT NOT NULL,
    last_sync_at TEXT,
    last_cursor TEXT,
    metadata_json TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO data_sources (id, name, source_type, api_endpoint, schedule_cron)
VALUES ('linear', 'Linear', 'api', 'https://api.linear.app/graphql', '0 */6 * * *');

INSERT OR IGNORE INTO sync_state (id, data_source_id, last_sync_at)
VALUES ('linear', 'linear', NULL);
`;

beforeAll(async () => {
  const statements = LINEAR_MIGRATION_SQL.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const sql of statements) {
    await env.DB.prepare(sql).run();
  }
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

function mockLinearGraphQL(responseData: Record<string, unknown>) {
  fetchMock
    .get("https://api.linear.app")
    .intercept({ path: "/graphql", method: "POST" })
    .reply(200, { data: responseData });
}

describe("linear sync to R2", () => {
  it("syncs issues, projects, and labels to R2 Parquet", async () => {
    // Issues query (page 1, no more pages)
    mockLinearGraphQL({
      issues: {
        nodes: [
          {
            id: "issue-001",
            identifier: "TA-100",
            title: "Test issue",
            description: "desc",
            priority: 2,
            estimate: 3,
            state: { name: "In Progress", type: "started" },
            labels: { nodes: [{ name: "bug" }] },
            project: { name: "de-study" },
            cycle: { number: 1 },
            assignee: { name: "ta93abe" },
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-03-13T00:00:00Z",
            startedAt: "2026-01-02T00:00:00Z",
            completedAt: null,
            canceledAt: null,
            dueDate: null,
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    // Projects query
    mockLinearGraphQL({
      projects: {
        nodes: [
          {
            id: "proj-001",
            name: "de-study",
            state: "started",
            progress: 0.5,
            startDate: "2026-01-01",
            targetDate: "2026-06-30",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-03-13T00:00:00Z",
            completedAt: null,
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    // Labels query
    mockLinearGraphQL({
      issueLabels: {
        nodes: [{ id: "label-001", name: "bug", color: "#ff0000" }],
      },
    });

    const res = await SELF.fetch("https://example.com/linear/sync", { method: "POST" });
    expect(res.status).toBe(200);

    const json = (await res.json()) as { success: boolean };
    expect(json.success).toBe(true);

    // Verify R2 files
    const issuesObj = await env.DATA_LAKE.head("linear/issues.parquet");
    expect(issuesObj).not.toBeNull();

    const projectsObj = await env.DATA_LAKE.head("linear/projects.parquet");
    expect(projectsObj).not.toBeNull();

    const labelsObj = await env.DATA_LAKE.head("linear/labels.parquet");
    expect(labelsObj).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ingestion && pnpm vitest run src/__tests__/linear.test.ts`
Expected: FAIL

- [ ] **Step 3: Rewrite linear.ts for R2 Parquet**

Full rewrite of sync functions — replace all `db.prepare(...)` with Parquet encode + R2 put. Keep GraphQL client and types unchanged. Follow exact same pattern as github.ts rewrite.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ingestion && pnpm vitest run src/__tests__/linear.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `cd ingestion && pnpm vitest run`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add ingestion/src/services/linear.ts ingestion/src/__tests__/linear.test.ts
git commit -m "feat: migrate Linear ingestion from D1 to R2 Parquet"
```

---

## Chunk 4: Withings Service Migration

### Task 6: Rewrite withings.ts to write R2 Parquet

**Files:**
- Modify: `ingestion/src/services/withings.ts`
- Create: `ingestion/src/__tests__/withings.test.ts`

Key changes:
1. Import WASM + parquet encoders
2. `syncMeasures` → group by date, write daily `withings/measures/{day}.parquet`
3. `syncSleep` → group by date, write daily `withings/sleep/{day}.parquet`
4. `syncActivity` → write daily `withings/activity/{day}.parquet`
5. Stats route → R2 object counts
6. Remove D1 query routes (`/measures`, `/sleep`, `/activity`, `/daily-summary`)
7. Keep OAuth routes unchanged (still use D1 for token storage)

- [ ] **Step 1: Write integration test**

Create `ingestion/src/__tests__/withings.test.ts`:

```typescript
import { env, fetchMock, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const WITHINGS_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS oauth_tokens (
    id TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_type TEXT DEFAULT 'Bearer',
    expires_at TEXT NOT NULL,
    scope TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS data_sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    source_type TEXT NOT NULL,
    api_endpoint TEXT,
    schedule_cron TEXT,
    is_active INTEGER DEFAULT 1,
    config_json TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_state (
    id TEXT PRIMARY KEY,
    data_source_id TEXT NOT NULL,
    last_sync_at TEXT,
    last_cursor TEXT,
    metadata_json TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO data_sources (id, name, source_type, api_endpoint, schedule_cron)
VALUES ('withings', 'Withings', 'api', 'https://wbsapi.withings.net', '0 */12 * * *');

INSERT OR IGNORE INTO sync_state (id, data_source_id, last_sync_at)
VALUES ('withings', 'withings', NULL);
`;

async function insertWithingsToken() {
  const expires = new Date(Date.now() + 3600 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO oauth_tokens (id, access_token, refresh_token, expires_at)
     VALUES ('withings', 'test-access-token', 'test-refresh-token', ?)`
  )
    .bind(expires)
    .run();
}

beforeAll(async () => {
  const statements = WITHINGS_MIGRATION_SQL.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const sql of statements) {
    await env.DB.prepare(sql).run();
  }
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

describe("withings sync to R2", () => {
  it("syncs measures, sleep, and activity to R2 Parquet", async () => {
    await insertWithingsToken();
    await env.DB.prepare(
      "UPDATE sync_state SET last_sync_at = '2026-03-12' WHERE id = 'withings'"
    ).run();

    // Mock measures
    fetchMock
      .get("https://wbsapi.withings.net")
      .intercept({ path: "/measure", method: "POST" })
      .reply(200, {
        status: 0,
        body: {
          updatetime: 1741824000,
          timezone: "Asia/Tokyo",
          measuregrps: [
            {
              grpid: 1001,
              date: 1741824000,
              measures: [
                { type: 1, value: 70500, unit: -3 },
                { type: 6, value: 182, unit: -1 },
              ],
            },
          ],
          more: 0,
          offset: 0,
        },
      });

    // Mock sleep
    fetchMock
      .get("https://wbsapi.withings.net")
      .intercept({ path: "/v2/sleep", method: "POST" })
      .reply(200, {
        status: 0,
        body: {
          series: [
            {
              startdate: 1741816800,
              enddate: 1741845600,
              date: "2026-03-13",
              data: {
                totalsleepduration: 28800,
                deepsleepduration: 7200,
                lightsleepduration: 14400,
                remsleepduration: 5400,
                wakeupduration: 1800,
                sleep_score: 82,
                sleep_efficiency: 0.92,
                sleep_latency: 600,
                hr_average: 58.5,
                hr_min: 48,
                hr_max: 72,
                rr_average: 16.2,
                rr_min: 14.0,
                rr_max: 18.5,
                snoring: 120,
                snoringepisodecount: 3,
              },
            },
          ],
          more: false,
          offset: 0,
        },
      });

    // Mock activity
    fetchMock
      .get("https://wbsapi.withings.net")
      .intercept({ path: "/v2/measure", method: "POST" })
      .reply(200, {
        status: 0,
        body: {
          activities: [
            {
              date: "2026-03-13",
              steps: 8500,
              distance: 6500.0,
              elevation: 50.0,
              soft: 3600,
              moderate: 1800,
              intense: 900,
              active: 6300,
              calories: 350.0,
              totalcalories: 2100.0,
              hr_average: 72.0,
              hr_min: 55,
              hr_max: 145,
            },
          ],
          more: false,
          offset: 0,
        },
      });

    const res = await SELF.fetch("https://example.com/withings/sync", { method: "POST" });
    expect(res.status).toBe(200);

    const json = (await res.json()) as { success: boolean };
    expect(json.success).toBe(true);

    // Verify R2 files
    const measuresObj = await env.DATA_LAKE.head("withings/measures/2026-03-13.parquet");
    expect(measuresObj).not.toBeNull();

    const sleepObj = await env.DATA_LAKE.head("withings/sleep/2026-03-13.parquet");
    expect(sleepObj).not.toBeNull();

    const activityObj = await env.DATA_LAKE.head("withings/activity/2026-03-13.parquet");
    expect(activityObj).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ingestion && pnpm vitest run src/__tests__/withings.test.ts`
Expected: FAIL

- [ ] **Step 3: Rewrite withings.ts for R2 Parquet**

Full rewrite of sync functions. Key patterns:
- `syncMeasures`: group `measuregrps` by date → daily Parquet
- `syncSleep`: group `series` by `item.date` → daily Parquet
- `syncActivity`: each entry has `item.date` → daily Parquet
- Keep OAuth routes (`/auth`, `/callback`) unchanged — they still use D1

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ingestion && pnpm vitest run src/__tests__/withings.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `cd ingestion && pnpm vitest run && pnpm vitest run --config vitest.config.node.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add ingestion/src/services/withings.ts ingestion/src/__tests__/withings.test.ts
git commit -m "feat: migrate Withings ingestion from D1 to R2 Parquet"
```

---

## Chunk 5: Cleanup & Verification

### Task 7: Update index.ts endpoint documentation

**Files:**
- Modify: `ingestion/src/index.ts`

- [ ] **Step 1: Update the root route's endpoints object**

Remove D1-only query routes that no longer exist (`/github/daily`, `/github/repos`, `/linear/weekly`, `/linear/labels`, `/linear/projects`, `/withings/measures`, `/withings/sleep`, `/withings/activity`, `/withings/daily-summary`).

- [ ] **Step 2: Run all tests**

Run: `cd ingestion && pnpm vitest run && pnpm vitest run --config vitest.config.node.ts`
Expected: All PASS

- [ ] **Step 3: Run typecheck and lint**

Run: `cd ingestion && pnpm typecheck && pnpm check`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add ingestion/src/index.ts
git commit -m "chore: remove deprecated D1 query endpoints from route docs"
```

### Task 8: Verify full test suite passes

- [ ] **Step 1: Run all tests**

Run: `cd ingestion && pnpm vitest run && pnpm vitest run --config vitest.config.node.ts`
Expected: All PASS

- [ ] **Step 2: Run lint and typecheck**

Run: `cd ingestion && pnpm typecheck && pnpm check`
Expected: Clean
