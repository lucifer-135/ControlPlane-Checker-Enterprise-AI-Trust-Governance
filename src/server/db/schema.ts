/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ControlPlane Checker SQLite Schema
 * Tamper-Evident Audit Logging, Review Decisions, API Keys, Session State,
 * Gateway Escalations, and Rolling Baseline State.
 *
 * Embedded as a module (rather than read from disk) so the bundled server
 * always carries the schema that matches its code.
 *
 * TABLES_SQL only creates tables and indexes on columns that have existed since
 * the first release. Columns added later are applied by column migrations in
 * database.ts, after which POST_MIGRATION_SQL creates the indexes and triggers
 * that depend on them.
 */

export const TABLES_SQL = `
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
  org_id TEXT,
  workspace_id TEXT,
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
  org_id TEXT,
  workspace_id TEXT,
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
  role TEXT NOT NULL DEFAULT 'service',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_state (
  session_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Durable record of gateway BLOCK_ESCALATE events, so the review queue survives
-- restarts and in-memory event-buffer eviction. Payloads are stored redacted.
CREATE TABLE IF NOT EXISTS gateway_escalations (
  interaction_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gateway_escalations_tenant ON gateway_escalations(org_id, workspace_id);

-- Versioned snapshot of the rolling (Welford) baseline tracker.
CREATE TABLE IF NOT EXISTS baseline_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
`;

/** Column migrations for databases created before these columns existed. */
export const COLUMN_MIGRATIONS: { table: string; column: string; definition: string }[] = [
  { table: 'audit_log', column: 'org_id', definition: 'TEXT' },
  { table: 'audit_log', column: 'workspace_id', definition: 'TEXT' },
  { table: 'review_decisions', column: 'org_id', definition: 'TEXT' },
  { table: 'review_decisions', column: 'workspace_id', definition: 'TEXT' },
  { table: 'api_keys', column: 'role', definition: "TEXT NOT NULL DEFAULT 'service'" },
];

export const POST_MIGRATION_SQL = `
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log(org_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_review_decisions_tenant ON review_decisions(org_id, workspace_id);

-- Review decisions are legally immutable: corrections are recorded as new rows.
CREATE TRIGGER IF NOT EXISTS trg_review_decisions_no_update
BEFORE UPDATE ON review_decisions
BEGIN
  SELECT RAISE(ABORT, 'review_decisions is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_review_decisions_no_delete
BEFORE DELETE ON review_decisions
BEGIN
  SELECT RAISE(ABORT, 'review_decisions is append-only');
END;

-- The audit chain is append-only as well.
CREATE TRIGGER IF NOT EXISTS trg_audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
`;
