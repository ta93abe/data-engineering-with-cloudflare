-- Linear Issues
CREATE TABLE IF NOT EXISTS linear_issues (
    id TEXT PRIMARY KEY,
    identifier TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description_length INTEGER DEFAULT 0,
    priority INTEGER,
    estimate REAL,
    state_name TEXT,
    state_type TEXT,
    label_names TEXT,
    project_name TEXT,
    cycle_number INTEGER,
    assignee_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    canceled_at TEXT,
    due_date TEXT,
    synced_at TEXT DEFAULT (datetime('now'))
);

-- Linear Projects
CREATE TABLE IF NOT EXISTS linear_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    state TEXT,
    progress REAL,
    start_date TEXT,
    target_date TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    synced_at TEXT DEFAULT (datetime('now'))
);

-- Linear Labels
CREATE TABLE IF NOT EXISTS linear_labels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT,
    synced_at TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_linear_issues_state ON linear_issues(state_type);
CREATE INDEX IF NOT EXISTS idx_linear_issues_project ON linear_issues(project_name);
CREATE INDEX IF NOT EXISTS idx_linear_issues_completed ON linear_issues(completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_linear_issues_updated ON linear_issues(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_linear_issues_identifier ON linear_issues(identifier);

-- Views
CREATE VIEW IF NOT EXISTS v_linear_weekly_completion AS
SELECT
    strftime('%Y-W%W', completed_at) AS week,
    count(*) AS completed_count,
    avg(julianday(completed_at) - julianday(created_at)) AS avg_lead_time_days
FROM linear_issues
WHERE completed_at IS NOT NULL
GROUP BY strftime('%Y-W%W', completed_at)
ORDER BY week DESC;

CREATE VIEW IF NOT EXISTS v_linear_label_summary AS
SELECT
    j.value AS label_name,
    count(*) AS issue_count,
    sum(CASE WHEN state_type = 'completed' THEN 1 ELSE 0 END) AS completed_count
FROM linear_issues, json_each(linear_issues.label_names) AS j
GROUP BY j.value
ORDER BY issue_count DESC;

CREATE VIEW IF NOT EXISTS v_linear_project_progress AS
SELECT
    project_name,
    count(*) AS total_issues,
    sum(CASE WHEN state_type = 'completed' THEN 1 ELSE 0 END) AS completed,
    sum(CASE WHEN state_type = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
    sum(CASE WHEN state_type IN ('backlog', 'unstarted') THEN 1 ELSE 0 END) AS pending,
    sum(CASE WHEN state_type = 'started' THEN 1 ELSE 0 END) AS in_progress,
    round(100.0 * sum(CASE WHEN state_type = 'completed' THEN 1 ELSE 0 END) / count(*), 1) AS completion_rate
FROM linear_issues
WHERE project_name IS NOT NULL
GROUP BY project_name;

-- Initial Data
INSERT OR IGNORE INTO data_sources (id, name, source_type, api_endpoint, schedule_cron)
VALUES ('linear', 'Linear', 'api', 'https://api.linear.app/graphql', '0 */6 * * *');

INSERT OR IGNORE INTO sync_state (id, data_source_id, last_sync_at)
VALUES ('linear', 'linear', NULL);
