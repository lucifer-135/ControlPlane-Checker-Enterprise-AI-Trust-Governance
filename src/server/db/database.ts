/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Database Adapter — Embedded SQLite with better-sqlite3
 *
 * Provides thread-safe, synchronous local storage for:
 * - Tamper-evident chained audit records
 * - Human-in-the-loop (HITL) review adjudications
 * - Multi-tenant API keys and RBAC
 * - Cross-turn session risk state
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';
import {
  computeRecordHMAC,
  hashPayload,
  type StoredAuditRecord,
  type AuditRecordPayload,
} from './auditChain.js';
import type {
  EvaluationResult,
  ReviewDecision,
  SessionState,
  SyntheticInteraction,
} from '../../types.js';

let db: Database.Database | null = null;

const DEFAULT_DB_DIR = path.resolve(process.cwd(), 'data');
const DEFAULT_DB_PATH = path.join(DEFAULT_DB_DIR, 'controlplane.db');

export function getDb(): Database.Database {
  if (!db) {
    initDatabase();
  }
  return db!;
}

export function closeDatabase(): void {
  if (db) {
    try {
      db.close();
    } catch {
      // Ignore errors on close
    }
    db = null;
  }
}

export function initDatabase(dbPath: string = DEFAULT_DB_PATH): Database.Database {
  if (db) {
    try {
      db.close();
    } catch {
      // Ignore errors on close
    }
    db = null;
  }

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Load and apply schema
  const candidatePaths = [
    path.resolve(process.cwd(), 'src/server/db/schema.sql'),
    path.resolve(process.cwd(), 'schema.sql'),
  ];
  let schemaSql = '';
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      schemaSql = fs.readFileSync(candidate, 'utf-8');
      break;
    }
  }
  if (!schemaSql) {
    // Fallback schema definition
    schemaSql = `
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
    `;
  }

  db.exec(schemaSql);
  console.log(`[Database] SQLite database initialized at: ${dbPath}`);

  // Seed default admin API key if table empty
  seedDefaultApiKey();

  return db;
}

function seedDefaultApiKey(): void {
  const countStmt = db!.prepare('SELECT COUNT(*) as count FROM api_keys');
  const result = countStmt.get() as { count: number };
  if (result.count === 0) {
    const defaultKey = 'cp_live_default_admin_key_2026';
    const keyHash = crypto.createHash('sha256').update(defaultKey).digest('hex');
    const insert = db!.prepare(`
      INSERT INTO api_keys (key_hash, org_id, workspace_id, description, policy_profile, rate_limit_rpm, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `);
    insert.run(
      keyHash,
      'org_default',
      'ws_production',
      'Default Seed Admin Key',
      'support_bot',
      500,
    );
    console.log(`[Database] Seeded default API key: ${defaultKey}`);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Audit Log Operations
// ──────────────────────────────────────────────────────────────────────

export function getLatestAuditHmac(): string | null {
  const row = getDb()
    .prepare('SELECT log_hmac FROM audit_log ORDER BY rowid DESC LIMIT 1')
    .get() as { log_hmac: string } | undefined;
  return row ? row.log_hmac : null;
}

export function insertAuditLog(
  interaction: SyntheticInteraction,
  evaluation: EvaluationResult,
  requestPrompt: string = interaction.prompt,
  responseText: string = interaction.response,
): StoredAuditRecord {
  const prevHmac = getLatestAuditHmac();
  const id = `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const timestamp = new Date().toISOString();
  const requestHash = hashPayload(requestPrompt);
  const responseHash = hashPayload(responseText);

  const payload: AuditRecordPayload = {
    id,
    interaction_id: interaction.id,
    timestamp,
    request_hash: requestHash,
    response_hash: responseHash,
    verdict: evaluation.verdict,
    composite_risk_score: evaluation.composite_risk_score,
    session_risk: evaluation.session_accumulated_risk,
    policy_version: evaluation.policy_profile_version,
    prev_log_hash: prevHmac,
  };

  const logHmac = computeRecordHMAC(payload);

  const insert = getDb().prepare(`
    INSERT INTO audit_log (
      id, interaction_id, timestamp, request_hash, response_hash,
      verdict, composite_risk_score, session_risk, performance_json,
      cost_json, responsibility_json, policy_version, prev_log_hash, log_hmac
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    id,
    interaction.id,
    timestamp,
    requestHash,
    responseHash,
    evaluation.verdict,
    evaluation.composite_risk_score,
    evaluation.session_accumulated_risk,
    JSON.stringify(evaluation.performance),
    JSON.stringify(evaluation.cost),
    JSON.stringify(evaluation.responsibility),
    evaluation.policy_profile_version,
    prevHmac,
    logHmac,
  );

  return {
    ...payload,
    performance_json: JSON.stringify(evaluation.performance),
    cost_json: JSON.stringify(evaluation.cost),
    responsibility_json: JSON.stringify(evaluation.responsibility),
    log_hmac: logHmac,
    created_at: timestamp,
  };
}

export function getAuditLogs(limit: number = 50, offset: number = 0): StoredAuditRecord[] {
  const rows = getDb()
    .prepare(
      `
    SELECT * FROM audit_log ORDER BY rowid DESC LIMIT ? OFFSET ?
  `,
    )
    .all(limit, offset) as StoredAuditRecord[];
  return rows;
}

export function getAllAuditLogsForVerification(): StoredAuditRecord[] {
  // Returns all logs in ascending chronological order for blockchain verification
  return getDb().prepare('SELECT * FROM audit_log ORDER BY rowid ASC').all() as StoredAuditRecord[];
}

// ──────────────────────────────────────────────────────────────────────
// Review Decisions (HITL Queue)
// ──────────────────────────────────────────────────────────────────────

export function insertReviewDecision(decision: ReviewDecision): void {
  const insert = getDb().prepare(`
    INSERT OR REPLACE INTO review_decisions (
      id, interaction_id, reviewer, action, notes, edited_response,
      original_verdict, new_verdict, primary_trigger_lane, reviewed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    decision.id,
    decision.interaction_id,
    decision.reviewer,
    decision.action,
    decision.notes,
    decision.edited_response || null,
    decision.original_verdict,
    decision.new_verdict,
    decision.primary_trigger_lane,
    decision.reviewed_at,
  );
}

export function getReviewDecisions(interactionId?: string): ReviewDecision[] {
  if (interactionId) {
    return getDb()
      .prepare('SELECT * FROM review_decisions WHERE interaction_id = ? ORDER BY rowid DESC')
      .all(interactionId) as ReviewDecision[];
  }
  return getDb()
    .prepare('SELECT * FROM review_decisions ORDER BY rowid DESC')
    .all() as ReviewDecision[];
}

export function deleteReviewDecision(id: string): boolean {
  const result = getDb().prepare('DELETE FROM review_decisions WHERE id = ?').run(id);
  return result.changes > 0;
}

export function clearReviewDecisions(): number {
  const result = getDb().prepare('DELETE FROM review_decisions').run();
  return result.changes;
}

// ──────────────────────────────────────────────────────────────────────
// API Keys & Multi-Tenancy
// ──────────────────────────────────────────────────────────────────────

export interface StoredApiKey {
  key_hash: string;
  org_id: string;
  workspace_id?: string;
  description?: string;
  policy_profile: string;
  rate_limit_rpm: number;
  is_active: number;
  created_at: string;
}

export function getApiKeyBySecret(rawKey: string): StoredApiKey | null {
  const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const row = getDb()
    .prepare('SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1')
    .get(hash) as StoredApiKey | undefined;
  return row || null;
}

export function createNewApiKey(
  orgId: string,
  workspaceId: string = 'default',
  description: string = '',
  policyProfile: string = 'support_bot',
  rpm: number = 100,
): { rawKey: string; keyInfo: StoredApiKey } {
  const rawSecret = `cp_live_${crypto.randomBytes(24).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(rawSecret).digest('hex');

  const insert = getDb().prepare(`
    INSERT INTO api_keys (key_hash, org_id, workspace_id, description, policy_profile, rate_limit_rpm, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  insert.run(keyHash, orgId, workspaceId, description, policyProfile, rpm);

  return {
    rawKey: rawSecret,
    keyInfo: {
      key_hash: keyHash,
      org_id: orgId,
      workspace_id: workspaceId,
      description,
      policy_profile: policyProfile,
      rate_limit_rpm: rpm,
      is_active: 1,
      created_at: new Date().toISOString(),
    },
  };
}

// ──────────────────────────────────────────────────────────────────────
// Session State Persistence
// ──────────────────────────────────────────────────────────────────────

export function saveDbSessionState(sessionId: string, state: SessionState): void {
  const stmt = getDb().prepare(`
    INSERT INTO session_state (session_id, state_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(session_id) DO UPDATE SET
      state_json = excluded.state_json,
      updated_at = datetime('now')
  `);
  stmt.run(sessionId, JSON.stringify(state));
}

export function loadDbSessionState(sessionId: string): SessionState | null {
  const row = getDb()
    .prepare('SELECT state_json FROM session_state WHERE session_id = ?')
    .get(sessionId) as { state_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.state_json);
  } catch {
    return null;
  }
}
