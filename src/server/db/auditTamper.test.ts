/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tamper-evidence tests: write a real chain to SQLite, attack it the way someone
 * with access to the database file could (triggers dropped), and check the
 * verifier catches every change and names where it happened.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type Database from 'better-sqlite3';
import {
  closeDatabase,
  getAllAuditLogsForVerification,
  getAuditChainHead,
  getDb,
  initDatabase,
  insertAuditLog,
} from './database.js';
import {
  computeHeadHMAC,
  computeRecordHMAC,
  getAuditSecret,
  hashPayload,
  verifyAuditChain,
  type StoredAuditRecord,
} from './auditChain.js';
import { SYNTHETIC_INTERACTIONS } from '../../data/interactions.js';
import { evaluateInteraction } from '../../lib/decisionEngine.js';
import { DEFAULT_POLICY_PROFILES } from '../../lib/policyProfiles.js';

const RECORDS = 5;

function writeChain(): Database.Database {
  for (const item of SYNTHETIC_INTERACTIONS.slice(0, RECORDS)) {
    insertAuditLog(item, evaluateInteraction(item, DEFAULT_POLICY_PROFILES[item.use_case]), {
      tenant: { orgId: 'org_a', workspaceId: 'ws1' },
    });
  }
  const db = getDb();
  // An attacker with file access is not stopped by triggers
  db.exec(
    'DROP TRIGGER trg_audit_log_no_update; DROP TRIGGER trg_audit_log_no_delete; DROP TRIGGER trg_audit_chain_head_no_delete;',
  );
  return db;
}

const ids = (db: Database.Database) =>
  (db.prepare('SELECT id FROM audit_log ORDER BY rowid').all() as { id: string }[]).map(
    (r) => r.id,
  );

const verify = () =>
  verifyAuditChain(getAllAuditLogsForVerification(), undefined, getAuditChainHead());

describe('audit chain tamper detection', () => {
  let db: Database.Database;

  beforeEach(() => {
    initDatabase(':memory:');
    db = writeChain();
  });

  afterEach(() => {
    closeDatabase();
  });

  it('verifies an untouched chain', () => {
    expect(verify()).toEqual({ valid: true, totalVerified: RECORDS });
  });

  it('detects a changed verdict at the exact record', () => {
    const target = ids(db)[2];
    db.prepare("UPDATE audit_log SET verdict = 'ALLOW' WHERE id = ?").run(target);
    expect(verify()).toMatchObject({
      valid: false,
      brokenAtIndex: 2,
      brokenRecordId: target,
      kind: 'signature',
    });
  });

  it('detects a changed risk score', () => {
    db.prepare('UPDATE audit_log SET composite_risk_score = 0.01 WHERE id = ?').run(ids(db)[2]);
    expect(verify()).toMatchObject({ valid: false, brokenAtIndex: 2 });
  });

  it('detects erased PII evidence', () => {
    db.prepare(
      `UPDATE audit_log SET responsibility_json = '{"pii_detected":[],"risk_score":0}' WHERE id = ?`,
    ).run(ids(db)[2]);
    const result = verify();
    expect(result).toMatchObject({ valid: false, brokenAtIndex: 2, kind: 'evidence' });
    expect(result.reason).toContain('Evidence tampered');
  });

  it('detects rewritten performance and cost evidence', () => {
    db.prepare("UPDATE audit_log SET performance_json = '{}', cost_json = '{}' WHERE id = ?").run(
      ids(db)[3],
    );
    expect(verify()).toMatchObject({ valid: false, brokenAtIndex: 3 });
  });

  it('detects a deleted middle record', () => {
    db.prepare('DELETE FROM audit_log WHERE id = ?').run(ids(db)[2]);
    expect(verify()).toMatchObject({ valid: false, brokenAtIndex: 2, kind: 'link' });
  });

  it('detects the most recent record being deleted', () => {
    db.prepare('DELETE FROM audit_log WHERE id = ?').run(ids(db).at(-1));
    const result = verify();
    expect(result).toMatchObject({ valid: false, kind: 'truncated' });
    expect(result.reason).toContain('Chain truncated');
  });

  it('detects the last two records being deleted', () => {
    const all = ids(db);
    db.prepare('DELETE FROM audit_log WHERE id IN (?, ?)').run(all[3], all[4]);
    expect(verify().reason).toContain('Chain truncated');
  });

  it('detects the first (genesis) record being deleted', () => {
    db.prepare('DELETE FROM audit_log WHERE id = ?').run(ids(db)[0]);
    const result = verify();
    expect(result).toMatchObject({ valid: false, brokenAtIndex: 0, kind: 'genesis' });
    expect(result.reason).toContain('does not start at genesis');
  });

  it('detects every record being deleted', () => {
    db.exec('DELETE FROM audit_log');
    const result = verify();
    expect(result.valid).toBe(false);
    expect(result.reason).toContain(`records ${RECORDS} entries`);
  });

  it('detects a record moved to another tenant', () => {
    db.prepare("UPDATE audit_log SET org_id = 'org_b' WHERE id = ?").run(ids(db)[1]);
    expect(verify()).toMatchObject({ valid: false, brokenAtIndex: 1 });
  });

  it('detects a truncated chain whose head was rewritten without the key', () => {
    const all = ids(db);
    db.prepare('DELETE FROM audit_log WHERE id = ?').run(all[4]);
    const last = (
      db.prepare('SELECT log_hmac FROM audit_log ORDER BY rowid DESC LIMIT 1').get() as {
        log_hmac: string;
      }
    ).log_hmac;
    db.prepare('UPDATE audit_chain_head SET record_count = 4, last_hmac = ?').run(last);
    expect(verify()).toMatchObject({ kind: 'head_invalid' });
    expect(verify().reason).toContain('head signature is invalid');
  });

  it('detects the chain head itself being deleted', () => {
    db.exec('DELETE FROM audit_chain_head');
    expect(verify()).toMatchObject({ kind: 'head_missing' });
    expect(verify().reason).toContain('Chain head is missing');
  });

  it('cannot be re-signed with the wrong key', () => {
    db.prepare("UPDATE audit_log SET verdict = 'ALLOW' WHERE id = ?").run(ids(db)[1]);
    let prev: string | null = null;
    for (const row of db.prepare('SELECT * FROM audit_log ORDER BY rowid').all() as any[]) {
      const hmac = computeRecordHMAC({ ...row, prev_log_hash: prev }, 'attacker-guessed-key-123');
      db.prepare('UPDATE audit_log SET prev_log_hash = ?, log_hmac = ? WHERE id = ?').run(
        prev,
        hmac,
        row.id,
      );
      prev = hmac;
    }
    db.prepare('UPDATE audit_chain_head SET last_hmac = ?, head_hmac = ?').run(
      prev,
      computeHeadHMAC(RECORDS, prev, 'attacker-guessed-key-123'),
    );
    expect(verify().valid).toBe(false);
  });
});

describe('audit chain compatibility and configuration', () => {
  it('still verifies version 1 records written before evidence signing', () => {
    const secret = 'legacy-secret-for-v1-records';
    const payload = {
      id: 'audit-legacy-0',
      interaction_id: 'int-legacy',
      timestamp: '2026-09-22T10:00:00Z',
      request_hash: hashPayload('prompt'),
      response_hash: hashPayload('response'),
      verdict: 'ALLOW',
      composite_risk_score: 0.1,
      session_risk: 0.1,
      policy_version: '1.0.0',
      prev_log_hash: null,
    };
    const record: StoredAuditRecord = { ...payload, log_hmac: computeRecordHMAC(payload, secret) };
    expect(verifyAuditChain([record], secret).valid).toBe(true);
  });

  it('pins the end of a chain that existed before the head was introduced', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-audit-upgrade-'));
    const file = path.join(dir, 'controlplane.db');
    try {
      initDatabase(file);
      const db = writeChain();
      db.exec('DROP TABLE audit_chain_head'); // as in a database from before the head existed
      closeDatabase();

      initDatabase(file); // upgrade: the head is pinned to the current end
      expect(getAuditChainHead()).toMatchObject({ record_count: RECORDS });
      expect(verify().valid).toBe(true);

      getDb().exec('DROP TRIGGER trg_audit_log_no_delete');
      getDb()
        .prepare('DELETE FROM audit_log WHERE rowid = (SELECT MAX(rowid) FROM audit_log)')
        .run();
      expect(verify().reason).toContain('Chain truncated');
    } finally {
      closeDatabase();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to sign without a secret in production', () => {
    const saved = { env: process.env.NODE_ENV, secret: process.env.AUDIT_HMAC_SECRET };
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.AUDIT_HMAC_SECRET;
      expect(() => getAuditSecret()).toThrow(/AUDIT_HMAC_SECRET/);
      process.env.AUDIT_HMAC_SECRET = 'too-short';
      expect(() => getAuditSecret()).toThrow(/AUDIT_HMAC_SECRET/);
      process.env.AUDIT_HMAC_SECRET = 'a-properly-long-production-secret';
      expect(getAuditSecret()).toBe('a-properly-long-production-secret');
    } finally {
      process.env.NODE_ENV = saved.env;
      if (saved.secret === undefined) delete process.env.AUDIT_HMAC_SECRET;
      else process.env.AUDIT_HMAC_SECRET = saved.secret;
    }
  });
});
