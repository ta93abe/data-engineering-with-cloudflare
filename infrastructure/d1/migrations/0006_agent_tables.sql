-- ============================================
-- Agent: Knowledge Base (embedded insights for RAG)
-- ============================================
CREATE TABLE IF NOT EXISTS agent_knowledge_base (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    content_type TEXT NOT NULL,  -- 'weekly_summary', 'insight', 'pattern', 'report'
    metadata_json TEXT,
    vector_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_kb_type
  ON agent_knowledge_base(content_type);

CREATE INDEX IF NOT EXISTS idx_agent_kb_vector
  ON agent_knowledge_base(vector_id);

-- ============================================
-- Agent: Generated Reports
-- ============================================
CREATE TABLE IF NOT EXISTS agent_reports (
    id TEXT PRIMARY KEY,
    report_type TEXT NOT NULL,  -- 'weekly_health', 'monthly_health', 'custom'
    title TEXT NOT NULL,
    period_start TEXT,
    period_end TEXT,
    r2_key TEXT NOT NULL,
    summary TEXT,
    vector_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_reports_type
  ON agent_reports(report_type, period_start DESC);

-- ============================================
-- Agent: Conversation Logs
-- ============================================
CREATE TABLE IF NOT EXISTS agent_conversation_logs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'chat',  -- 'chat', 'slack'
    user_message TEXT NOT NULL,
    assistant_response TEXT,
    tools_used TEXT,
    model_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_convo_session
  ON agent_conversation_logs(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_convo_created
  ON agent_conversation_logs(created_at DESC);
