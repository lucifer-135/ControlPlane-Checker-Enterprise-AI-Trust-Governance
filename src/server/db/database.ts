/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Database Adapter — Embedded SQLite with better-sqlite3
 *
 * Provides thread-safe, synchronous local storage for:
 * - Tamper-evident chained audit records (append-only, tenant-bound)
 * - Human-in-the-lead (HITL) review adjudications (append-only, tenant-bound)
 * - Multi-tenant API keys and RBAC roles
 * - Durable gateway escalations awaiting review
 * - Rolling baseline tracker snapshots
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
import { TABLES_SQL, COLUMN_MIGRATIONS, POST_MIGRATION_SQL } from './schema.js';
import { DEMO_API_KEY, getBootstrapAdminKey, isDemoKeyAllowed } from '../config.js';
import type {
  EvaluationResult,
  ReviewDecision,
  SessionState,
  SyntheticInteraction,
} from '../../types.js';

let db: Database.Database | null = null;

const DEFAULT_DB_DIR = path.resolve(process.cwd(), 'data');
const DEFAULT_DB_PATH = path.join(DEFAULT_DB_DIR, 'controlplane.db');

/** CONTROLPLANE_DB_PATH overrides the on-disk location (tests use ':memory:'). */
function resolveDbPath(): string {
  return process.env.CONTROLPLANE_DB_PATH || DEFAULT_DB_PATH;
}

/** Restricts a query to one org, and optionally one workspace within it. */
export interface TenantFilter {
  orgId: string;
  workspaceId?: string;
}

/** Tenant stamp written onto audit records and review decisions. */
export interface TenantStamp {
  orgId: string;
  workspaceId: string;
}

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

export function initDatabase(dbPath: string = resolveDbPath()): Database.Database {
  if (db) {
    try {
      db.close();
    } catch {
      // Ignore errors on close
    }
    db = null;
  }

  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(TABLES_SQL);
  applyColumnMigrations(db);
  db.exec(POST_MIGRATION_SQL);
  console.log(`[Database] SQLite database initialized at: ${dbPath}`);

  seedApiKeys();

  return db;
}

function applyColumnMigrations(database: Database.Database): void {
  for (const { table, column, definition } of COLUMN_MIGRATIONS) {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      console.log(`[Database] Migrated ${table}: added column ${column}`);
    }
  }
}

function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

function seedApiKeys(): void {
  const demoHash = hashApiKey(DEMO_API_KEY);

  if (isDemoKeyAllowed()) {
    const existing = db!.prepare('SELECT key_hash FROM api_keys WHERE key_hash = ?').get(demoHash);
    const { count } = db!.prepare('SELECT COUNT(*) as count FROM api_keys').get() as {
      count: number;
    };
    if (existing) {
      db!
        .prepare("UPDATE api_keys SET role = 'admin', is_active = 1 WHERE key_hash = ?")
        .run(demoHash);
    } else if (count === 0) {
      db!
        .prepare(
          `INSERT INTO api_keys (key_hash, org_id, workspace_id, description, policy_profile, rate_limit_rpm, is_active, role)
         VALUES (?, ?, ?, ?, ?, ?, 1, 'admin')`,
        )
        .run(
          demoHash,
          'org_default',
          'ws_production',
          'Default Seed Admin Key (dev only)',
          'support_bot',
          500,
        );
      console.log(`[Database] Seeded local-dev admin API key: ${DEMO_API_KEY}`);
    }
  } else {
    const result = db!
      .prepare('UPDATE api_keys SET is_active = 0 WHERE key_hash = ? AND is_active = 1')
      .run(demoHash);
    if (result.changes > 0) {
      console.warn(
        '[Database] Disabled the hard-coded demo API key (not permitted outside dev mode)',
      );
    }
  }

  const bootstrapKey = getBootstrapAdminKey();
  if (bootstrapKey) {
    const inserted = db!
      .prepare(
        `INSERT OR IGNORE INTO api_keys (key_hash, org_id, workspace_id, description, policy_profile, rate_limit_rpm, is_active, role)
         VALUES (?, ?, ?, ?, ?, ?, 1, 'admin')`,
      )
      .run(
        hashApiKey(bootstrapKey),
        process.env.CONTROLPLANE_BOOTSTRAP_ORG_ID || 'org_default',
        process.env.CONTROLPLANE_BOOTSTRAP_WORKSPACE_ID || 'ws_production',
        'Bootstrap Admin Key (CONTROLPLANE_BOOTSTRAP_ADMIN_KEY)',
        'support_bot',
        500,
      );
    if (inserted.changes > 0) {
      console.log('[Database] Registered bootstrap admin API key from environment');
    }
  }
}

function tenantWhere(
  filter: TenantFilter | undefined,
  alias = '',
): { sql: string; params: string[] } {
  if (!filter) return { sql: '', params: [] };
  const prefix = alias ? `${alias}.` : '';
  if (filter.workspaceId) {
    return {
      sql: `${prefix}org_id = ? AND ${prefix}workspace_id = ?`,
      params: [filter.orgId, filter.workspaceId],
    };
  }
  return { sql: `${prefix}org_id = ?`, params: [filter.orgId] };
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

export interface InsertAuditOptions {
  tenant?: TenantStamp | null;
  requestPrompt?: string;
  responseText?: string;
}

export function insertAuditLog(
  interaction: SyntheticInteraction,
  evaluation: EvaluationResult,
  options: InsertAuditOptions = {},
): StoredAuditRecord {
  const requestPrompt = options.requestPrompt ?? interaction.prompt;
  const responseText = options.responseText ?? interaction.response;
  const tenant = options.tenant ?? null;

  const prevHmac = getLatestAuditHmac();
  const id = `audit-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
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
    org_id: tenant?.orgId ?? null,
    workspace_id: tenant?.workspaceId ?? null,
  };

  const logHmac = computeRecordHMAC(payload);

  const insert = getDb().prepare(`
    INSERT INTO audit_log (
      id, interaction_id, timestamp, request_hash, response_hash,
      verdict, composite_risk_score, session_risk, performance_json,
      cost_json, responsibility_json, policy_version, prev_log_hash, log_hmac,
      org_id, workspace_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    payload.org_id,
    payload.workspace_id,
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

export function getAuditLogs(
  limit: number = 50,
  offset: number = 0,
  filter?: TenantFilter,
): StoredAuditRecord[] {
  const where = tenantWhere(filter);
  return getDb()
    .prepare(
      `SELECT * FROM audit_log ${where.sql ? `WHERE ${where.sql}` : ''} ORDER BY rowid DESC LIMIT ? OFFSET ?`,
    )
    .all(...where.params, limit, offset) as StoredAuditRecord[];
}

export function getAllAuditLogsForVerification(): StoredAuditRecord[] {
  // Returns all logs in ascending chronological order for blockchain verification
  return getDb().prepare('SELECT * FROM audit_log ORDER BY rowid ASC').all() as StoredAuditRecord[];
}

// ──────────────────────────────────────────────────────────────────────
// Review Decisions (HITL Queue) — append-only
// ──────────────────────────────────────────────────────────────────────

export class DuplicateReviewDecisionError extends Error {
  constructor(id: string) {
    super(`Review decision '${id}' already exists; decisions are append-only`);
    this.name = 'DuplicateReviewDecisionError';
  }
}

/**
 * Appends a review decision. Existing decisions can never be replaced or deleted
 * (SQLite triggers enforce this); a correction is recorded as a new decision for
 * the same interaction, and the most recent decision is the effective one.
 */
export function insertReviewDecision(
  decision: ReviewDecision,
  tenant: TenantStamp | null = null,
): void {
  const insert = getDb().prepare(`
    INSERT INTO review_decisions (
      id, interaction_id, reviewer, action, notes, edited_response,
      original_verdict, new_verdict, primary_trigger_lane, reviewed_at,
      org_id, workspace_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
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
      tenant?.orgId ?? null,
      tenant?.workspaceId ?? null,
    );
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new DuplicateReviewDecisionError(decision.id);
    }
    throw err;
  }
}

export function getReviewDecisions(
  interactionId?: string,
  filter?: TenantFilter,
): ReviewDecision[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (interactionId) {
    clauses.push('interaction_id = ?');
    params.push(interactionId);
  }
  const where = tenantWhere(filter);
  if (where.sql) {
    clauses.push(where.sql);
    params.push(...where.params);
  }
  const rows = getDb()
    .prepare(
      `SELECT id, interaction_id, reviewer, action, notes, edited_response, original_verdict,
              new_verdict, primary_trigger_lane, reviewed_at
       FROM review_decisions ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY rowid DESC`,
    )
    .all(...params) as (ReviewDecision & { edited_response: string | null })[];
  return rows.map((r) => {
    const { edited_response, ...rest } = r;
    return edited_response ? { ...rest, edited_response } : rest;
  });
}

// ──────────────────────────────────────────────────────────────────────
// Gateway Escalations (durable review queue input)
// ──────────────────────────────────────────────────────────────────────

export function insertGatewayEscalation(
  interactionId: string,
  tenant: TenantStamp,
  eventJson: string,
): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO gateway_escalations (interaction_id, org_id, workspace_id, event_json)
       VALUES (?, ?, ?, ?)`,
    )
    .run(interactionId, tenant.orgId, tenant.workspaceId, eventJson);
}

/**
 * Returns stored escalations that have no review decision yet (oldest first
 * within the returned window of most recent items).
 */
export function getPendingGatewayEscalations(limit: number = 100, filter?: TenantFilter): string[] {
  const where = tenantWhere(filter, 'e');
  const rows = getDb()
    .prepare(
      `SELECT e.event_json FROM gateway_escalations e
       WHERE NOT EXISTS (SELECT 1 FROM review_decisions r WHERE r.interaction_id = e.interaction_id)
       ${where.sql ? `AND ${where.sql}` : ''}
       ORDER BY e.rowid DESC LIMIT ?`,
    )
    .all(...where.params, limit) as { event_json: string }[];
  return rows.map((r) => r.event_json).reverse();
}

export function getGatewayEscalationEvent(interactionId: string): string | null {
  const row = getDb()
    .prepare('SELECT event_json FROM gateway_escalations WHERE interaction_id = ?')
    .get(interactionId) as { event_json: string } | undefined;
  return row ? row.event_json : null;
}

// ──────────────────────────────────────────────────────────────────────
// Rolling Baseline Snapshots
// ──────────────────────────────────────────────────────────────────────

export function saveBaselineState(schemaVersion: number, stateJson: string): void {
  getDb()
    .prepare(
      `INSERT INTO baseline_state (id, schema_version, state_json, updated_at)
       VALUES (1, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         schema_version = excluded.schema_version,
         state_json = excluded.state_json,
         updated_at = datetime('now')`,
    )
    .run(schemaVersion, stateJson);
}

export function loadBaselineState(): { schemaVersion: number; stateJson: string } | null {
  const row = getDb()
    .prepare('SELECT schema_version, state_json FROM baseline_state WHERE id = 1')
    .get() as { schema_version: number; state_json: string } | undefined;
  return row ? { schemaVersion: row.schema_version, stateJson: row.state_json } : null;
}

// ──────────────────────────────────────────────────────────────────────
// API Keys & Multi-Tenancy
// ──────────────────────────────────────────────────────────────────────

/**
 * RBAC roles, lowest to highest privilege:
 * - service:  may call the proxy and evaluation endpoints only
 * - viewer:   may also read events, audit logs, decisions, policies (own tenant)
 * - reviewer: may also record review decisions (own tenant)
 * - admin:    may also change policies, baselines, and create keys (own org)
 */
export type ApiKeyRole = 'service' | 'viewer' | 'reviewer' | 'admin';
export const API_KEY_ROLES: ApiKeyRole[] = ['service', 'viewer', 'reviewer', 'admin'];

export interface StoredApiKey {
  key_hash: string;
  org_id: string;
  workspace_id?: string;
  description?: string;
  policy_profile: string;
  rate_limit_rpm: number;
  is_active: number;
  role: ApiKeyRole;
  created_at: string;
}

export function getApiKeyBySecret(rawKey: string): StoredApiKey | null {
  if (rawKey === DEMO_API_KEY && !isDemoKeyAllowed()) {
    return null;
  }
  const row = getDb()
    .prepare('SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1')
    .get(hashApiKey(rawKey)) as StoredApiKey | undefined;
  if (!row) return null;
  return { ...row, role: API_KEY_ROLES.includes(row.role) ? row.role : 'service' };
}

export function createNewApiKey(
  orgId: string,
  workspaceId: string = 'default',
  description: string = '',
  policyProfile: string = 'support_bot',
  rpm: number = 100,
  role: ApiKeyRole = 'service',
): { rawKey: string; keyInfo: StoredApiKey } {
  const rawSecret = `cp_live_${crypto.randomBytes(24).toString('hex')}`;
  const keyHash = hashApiKey(rawSecret);

  const insert = getDb().prepare(`
    INSERT INTO api_keys (key_hash, org_id, workspace_id, description, policy_profile, rate_limit_rpm, is_active, role)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `);
  insert.run(keyHash, orgId, workspaceId, description, policyProfile, rpm, role);

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
      role,
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
