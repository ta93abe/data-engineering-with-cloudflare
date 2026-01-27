-- ============================================
-- Core Infrastructure Tables
-- ============================================

-- データソース設定
CREATE TABLE IF NOT EXISTS data_sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    source_type TEXT NOT NULL,  -- 'api', 'export', 'manual'
    api_endpoint TEXT,
    schedule_cron TEXT,
    is_active INTEGER DEFAULT 1,
    config_json TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- パイプライン実行履歴
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id TEXT PRIMARY KEY,
    data_source_id TEXT NOT NULL,
    run_type TEXT NOT NULL,  -- 'full', 'incremental'
    status TEXT NOT NULL,  -- 'pending', 'running', 'success', 'failed'
    started_at TEXT NOT NULL,
    completed_at TEXT,
    records_processed INTEGER DEFAULT 0,
    records_failed INTEGER DEFAULT 0,
    error_message TEXT,
    r2_output_path TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (data_source_id) REFERENCES data_sources(id)
);

-- エラーログ
CREATE TABLE IF NOT EXISTS error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_run_id TEXT,
    error_type TEXT NOT NULL,
    error_message TEXT NOT NULL,
    stack_trace TEXT,
    context_json TEXT,
    occurred_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (pipeline_run_id) REFERENCES pipeline_runs(id)
);

-- 同期状態（増分同期用）
CREATE TABLE IF NOT EXISTS sync_state (
    id TEXT PRIMARY KEY,
    data_source_id TEXT NOT NULL,
    last_sync_at TEXT,
    last_cursor TEXT,
    metadata_json TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (data_source_id) REFERENCES data_sources(id)
);

-- Core Infrastructure Indexes
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_source ON pipeline_runs(data_source_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_occurred ON error_logs(occurred_at DESC);

-- ============================================
-- GitHub Tables
-- ============================================

CREATE TABLE IF NOT EXISTS github_users (
    id INTEGER PRIMARY KEY,
    login TEXT UNIQUE NOT NULL,
    name TEXT,
    avatar_url TEXT,
    synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS github_repos (
    id INTEGER PRIMARY KEY,
    owner_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    full_name TEXT UNIQUE NOT NULL,
    description TEXT,
    language TEXT,
    stars INTEGER DEFAULT 0,
    forks INTEGER DEFAULT 0,
    is_private INTEGER DEFAULT 0,
    default_branch TEXT,
    synced_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES github_users(id)
);

CREATE TABLE IF NOT EXISTS github_commits (
    sha TEXT PRIMARY KEY,
    repo_id INTEGER NOT NULL,
    message TEXT,
    author_name TEXT,
    author_email TEXT,
    author_date TEXT NOT NULL,
    additions INTEGER DEFAULT 0,
    deletions INTEGER DEFAULT 0,
    files_changed INTEGER DEFAULT 0,
    synced_at TEXT NOT NULL,
    FOREIGN KEY (repo_id) REFERENCES github_repos(id)
);

-- GitHub Indexes
CREATE INDEX IF NOT EXISTS idx_github_commits_repo ON github_commits(repo_id);
CREATE INDEX IF NOT EXISTS idx_github_commits_date ON github_commits(author_date DESC);
CREATE INDEX IF NOT EXISTS idx_github_repos_owner ON github_repos(owner_id);
CREATE INDEX IF NOT EXISTS idx_github_repos_language ON github_repos(language);

-- ============================================
-- Views
-- ============================================

CREATE VIEW IF NOT EXISTS v_daily_commits AS
SELECT
    date(author_date) AS commit_date,
    count(*) AS commit_count,
    sum(additions) AS total_additions,
    sum(deletions) AS total_deletions,
    count(DISTINCT repo_id) AS repos_touched
FROM github_commits
GROUP BY date(author_date)
ORDER BY commit_date DESC;

CREATE VIEW IF NOT EXISTS v_repo_stats AS
SELECT
    r.full_name,
    r.language,
    count(c.sha) AS total_commits,
    sum(c.additions) AS total_additions,
    sum(c.deletions) AS total_deletions,
    max(c.author_date) AS last_commit_date
FROM github_repos r
LEFT JOIN github_commits c ON r.id = c.repo_id
GROUP BY r.id
ORDER BY total_commits DESC;

CREATE VIEW IF NOT EXISTS v_weekly_activity AS
SELECT
    strftime('%Y-W%W', author_date) AS week,
    count(*) AS commits,
    count(DISTINCT repo_id) AS active_repos,
    sum(additions + deletions) AS lines_changed
FROM github_commits
GROUP BY strftime('%Y-W%W', author_date)
ORDER BY week DESC;

-- ============================================
-- Initial Data
-- ============================================

INSERT OR IGNORE INTO data_sources (id, name, source_type, api_endpoint, schedule_cron)
VALUES ('github', 'GitHub', 'api', 'https://api.github.com', '0 0 * * *');
