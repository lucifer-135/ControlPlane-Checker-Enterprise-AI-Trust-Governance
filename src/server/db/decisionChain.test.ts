/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type Database from 'better-sqlite3';
import {
  closeDatabase,
  getAllReviewDecisionsForVerification,
  getDb,
  getReviewChainHead,
  initDatabase,
  insertReviewDecision,
} from './database.js';
import { computeChainHeadHMAC } from './auditChain.js';
import {
  computeDecisionHMAC,
  DECISION_CHAIN_HEAD_TAG,
  summarizeDecisionBlocks,
  verifyDecisionChain,
} from './decisionChain.js';
import type { ReviewDecision } from '../../types.js';

let written = 0;

/** Appends a decision as the Review Queue would. */
function decide(action: ReviewDecision['action'], orgId = 'org_a'): string {
  const n = written++;
  const id = `dec-${n}`;
  insertReviewDecision(
    {
      id,
      interaction_id: `int-${n}`,
      reviewed_at: `2026-09-30T10:0${n}:00.000Z`,
      reviewer: 'Local development admin',
      action,
      notes: 'Reviewed during the demo',
      original_verdict: 'BLOCK_ESCALATE',
      new_verdict: action === 'CONFIRM_BLOCK' ? 'BLOCK_ESCALATE' : 'ALLOW',
      primary_trigger_lane: 'responsibility',
    },
    { orgId, workspaceId: 'ws1' },
  );
  return id;
}

const verify = () =>
  verifyDecisionChain(getAllReviewDecisionsForVerification(), undefined, getReviewChainHead());

describe('review decision chain', () => {
  let db: Database.Database;
  let ids: string[];

  beforeEach(() => {
    written = 0;
    initDatabase(':memory:');
    ids = [
      decide('CONFIRM_BLOCK'),
      decide('EDIT_ALLOW'),
      decide('CONFIRM_BLOCK'),
      decide('OVERRIDE_ALLOW'),
      decide('CONFIRM_BLOCK'),
    ];
    db = getDb();
    // Someone with access to the file is not stopped by triggers
    db.exec(
      'DROP TRIGGER trg_review_decisions_no_update; DROP TRIGGER trg_review_decisions_no_delete; DROP TRIGGER trg_review_chain_head_no_delete;',
    );
  });

  afterEach(() => {
    closeDatabase();
  });

  it('signs every decision and links it to the one before', () => {
    expect(verify()).toEqual({ valid: true, totalVerified: 5 });
    const records = getAllReviewDecisionsForVerification();
    expect(records[0].prev_hmac).toBeNull();
    for (let i = 1; i < records.length; i++) {
      expect(records[i].prev_hmac).toBe(records[i - 1].hmac);
    }
    expect(getReviewChainHead()).toMatchObject({ record_count: 5, last_hmac: records[4].hmac });
  });

  it('detects a reversed decision at the exact record', () => {
    db.prepare(
      "UPDATE review_decisions SET action = 'OVERRIDE_ALLOW', new_verdict = 'ALLOW' WHERE id = ?",
    ).run(ids[2]);
    expect(verify()).toMatchObject({
      valid: false,
      brokenAtIndex: 2,
      brokenRecordId: ids[2],
      kind: 'signature',
    });
  });

  it('detects a decision attributed to someone else', () => {
    db.prepare("UPDATE review_decisions SET reviewer = 'Someone Else' WHERE id = ?").run(ids[1]);
    expect(verify()).toMatchObject({ valid: false, brokenAtIndex: 1, kind: 'signature' });
  });

  it('detects deleted decisions: in the middle, at the start and at the end', () => {
    db.prepare('DELETE FROM review_decisions WHERE id = ?').run(ids[2]);
    expect(verify()).toMatchObject({ valid: false, brokenAtIndex: 2, kind: 'link' });
  });

  it('detects the first decision being deleted', () => {
    db.prepare('DELETE FROM review_decisions WHERE id = ?').run(ids[0]);
    expect(verify()).toMatchObject({ valid: false, brokenAtIndex: 0, kind: 'genesis' });
  });

  it('detects the newest decisions being deleted', () => {
    db.prepare('DELETE FROM review_decisions WHERE id IN (?, ?)').run(ids[3], ids[4]);
    expect(verify()).toMatchObject({ valid: false, kind: 'truncated' });
  });

  it('detects an altered or removed chain head', () => {
    db.prepare('UPDATE review_chain_head SET record_count = 4').run();
    expect(verify()).toMatchObject({ valid: false, kind: 'head_invalid' });
    db.exec('DELETE FROM review_chain_head');
    expect(verify()).toMatchObject({ valid: false, kind: 'head_missing' });
  });

  it('cannot be re-signed without the key', () => {
    const key = 'attacker-guessed-key-123';
    db.prepare("UPDATE review_decisions SET action = 'OVERRIDE_ALLOW' WHERE id = ?").run(ids[0]);
    let prev: string | null = null;
    for (const row of db.prepare('SELECT * FROM review_decisions ORDER BY rowid').all() as any[]) {
      const hmac = computeDecisionHMAC({ ...row, prev_hmac: prev }, key);
      db.prepare('UPDATE review_decisions SET prev_hmac = ?, hmac = ? WHERE id = ?').run(
        prev,
        hmac,
        row.id,
      );
      prev = hmac;
    }
    db.prepare('UPDATE review_chain_head SET last_hmac = ?, head_hmac = ?').run(
      prev,
      computeChainHeadHMAC(DECISION_CHAIN_HEAD_TAG, 5, prev, key),
    );
    expect(verify().valid).toBe(false);
  });

  it("shows only the place in the chain of another tenant's decisions", () => {
    decide('CONFIRM_BLOCK', 'org_b');
    const records = getAllReviewDecisionsForVerification();
    const blocks = summarizeDecisionBlocks(records, verify(), 12, (r) => r.org_id === 'org_a');
    expect(blocks.at(-1)).toMatchObject({ interaction_id: null, action: null, reviewer: null });
    expect(blocks[0]).toMatchObject({ action: 'CONFIRM_BLOCK', state: 'verified' });
  });
});

describe('decisions recorded before decisions were signed', () => {
  it('are signed once at startup, in order, and verify from then on', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-decisions-'));
    const file = path.join(dir, 'controlplane.db');
    try {
      written = 0;
      initDatabase(file);
      decide('CONFIRM_BLOCK');
      decide('OVERRIDE_ALLOW');
      decide('CONFIRM_BLOCK');
      // As in a database from before decisions were signed
      getDb().exec(
        'DROP TRIGGER trg_review_decisions_no_update; DROP TRIGGER trg_review_chain_head_no_delete;' +
          'UPDATE review_decisions SET prev_hmac = NULL, hmac = NULL; DELETE FROM review_chain_head;',
      );
      closeDatabase();

      initDatabase(file);
      expect(verify()).toEqual({ valid: true, totalVerified: 3 });
      // The append-only protection is back
      expect(() =>
        getDb().prepare("UPDATE review_decisions SET action = 'OVERRIDE_ALLOW'").run(),
      ).toThrow(/append-only/);
    } finally {
      closeDatabase();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
