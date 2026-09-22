-- ControlPlane Checker SQLite Schema
-- Tamper-Evident Audit Logging, Review Decisions, API Keys, and Session State

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  interaction_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_hash TEXT NOT NULL,
  verdict TEXT NOT NULL,
  composite_risk_score REAL NOT NULL,
  session_risk REAL NOT NULL,
  performance_json TEXT,
  cost_json TEXT,
  responsibility_json TEXT,
  policy_version TEXT,
  prev_log_hash TEXT,
  log_hmac TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_interaction_id ON audit_log(interaction_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);

CREATE TABLE IF NOT EXISTS review_decisions (
  id TEXT PRIMARY KEY,
  interaction_id TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  action TEXT NOT NULL,
  notes TEXT,
  edited_response TEXT,
  original_verdict TEXT,
  new_verdict TEXT,
  primary_trigger_lane TEXT,
  reviewed_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_review_decisions_interaction ON review_decisions(interaction_id);

CREATE TABLE IF NOT EXISTS api_keys (
  key_hash TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  workspace_id TEXT,
  description TEXT,
  policy_profile TEXT DEFAULT 'support_bot',
  rate_limit_rpm INTEGER DEFAULT 100,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_state (
  session_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
