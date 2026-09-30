/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  closeDatabase,
  getAllReviewDecisionsForVerification,
  getDb,
  getReviewChainHead,
  initDatabase,
  insertReviewDecision,
} from './database.js';
import { verifyDecisionChain } from './decisionChain.js';
import { tamperReviewDecision, undoFileFor, undoTamper } from './demoTamper.js';
import type { ReviewDecision } from '../../types.js';

const verify = () =>
  verifyDecisionChain(getAllReviewDecisionsForVerification(), undefined, getReviewChainHead());

describe('demo tamper tool', () => {
  let dir: string;
  let file: string;
  let written = 0;

  /** Appends decisions as the Review Queue would. */
  const decide = (...actions: ReviewDecision['action'][]) => {
    for (const action of actions) {
      const n = written++;
      insertReviewDecision(
        {
          id: `dec-${n}`,
          interaction_id: `int-sb-00${n}`,
          reviewed_at: `2026-09-30T11:0${n}:00.000Z`,
          reviewer: 'Local development admin',
          action,
          notes: '',
          original_verdict: 'BLOCK_ESCALATE',
          new_verdict: action === 'CONFIRM_BLOCK' ? 'BLOCK_ESCALATE' : 'ALLOW',
          primary_trigger_lane: 'responsibility',
        },
        { orgId: 'org_a', workspaceId: 'ws1' },
      );
    }
  };

  beforeEach(() => {
    written = 0;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-tamper-'));
    file = path.join(dir, 'controlplane.db');
    initDatabase(file);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reverses the latest confirmed block that has decisions after it, and the chain names it', () => {
    decide('CONFIRM_BLOCK', 'EDIT_ALLOW', 'CONFIRM_BLOCK', 'OVERRIDE_ALLOW');
    const report = tamperReviewDecision(file);
    expect(report).toMatchObject({
      mode: 'reverse',
      position: 3,
      total: 4,
      interactionId: 'int-sb-002',
      actionBefore: 'CONFIRM_BLOCK',
      actionAfter: 'OVERRIDE_ALLOW',
      verdictBefore: 'BLOCK_ESCALATE',
      verdictAfter: 'ALLOW',
    });
    expect(verify()).toMatchObject({
      valid: false,
      brokenAtIndex: 2,
      brokenRecordId: report.decisionId,
      kind: 'signature',
    });
  });

  it('puts the append-only triggers back, so the database looks untouched', () => {
    decide('CONFIRM_BLOCK', 'OVERRIDE_ALLOW');
    tamperReviewDecision(file);
    expect(() =>
      getDb().prepare("UPDATE review_decisions SET action = 'OVERRIDE_ALLOW'").run(),
    ).toThrow(/append-only/);
    expect(() => getDb().prepare('DELETE FROM review_decisions').run()).toThrow(/append-only/);
  });

  it('undo restores the decision and the chain verifies again, even after new decisions', () => {
    decide('CONFIRM_BLOCK', 'OVERRIDE_ALLOW');
    tamperReviewDecision(file);
    decide('EDIT_ALLOW'); // reviewers keep working in the meantime
    expect(verify().valid).toBe(false);

    const restored = undoTamper(file);
    expect(restored.position).toBe(1);
    expect(verify()).toEqual({ valid: true, totalVerified: 3 });
    expect(fs.existsSync(undoFileFor(file))).toBe(false);
  });

  it('deletes a decision, never the newest, and puts it back in its place', () => {
    decide('OVERRIDE_ALLOW', 'EDIT_ALLOW', 'CONFIRM_BLOCK');
    const report = tamperReviewDecision(file, 'delete');
    expect(report).toMatchObject({ mode: 'delete', position: 2, actionAfter: null });
    expect(verify()).toMatchObject({ valid: false, brokenAtIndex: 1, kind: 'link' });

    undoTamper(file);
    expect(verify()).toEqual({ valid: true, totalVerified: 3 });
  });

  it('picks the latest decision on an interaction', () => {
    decide('CONFIRM_BLOCK', 'OVERRIDE_ALLOW', 'CONFIRM_BLOCK');
    const report = tamperReviewDecision(file, 'reverse', { interactionId: 'int-sb-001' });
    expect(report).toMatchObject({
      position: 2,
      actionBefore: 'OVERRIDE_ALLOW',
      actionAfter: 'CONFIRM_BLOCK',
    });
    expect(verify()).toMatchObject({ valid: false, brokenAtIndex: 1 });
  });

  it('refuses what it cannot do safely', () => {
    expect(() => tamperReviewDecision(file)).toThrow(/no decisions yet/);
    decide('CONFIRM_BLOCK', 'OVERRIDE_ALLOW');
    expect(() => tamperReviewDecision(file, 'delete', { position: 2 })).toThrow(/newest decision/);
    expect(() => tamperReviewDecision(file, 'reverse', { interactionId: 'int-none' })).toThrow(
      /No decision on interaction/,
    );
    expect(() => undoTamper(file)).toThrow(/Nothing to undo/);

    tamperReviewDecision(file);
    expect(() => tamperReviewDecision(file)).toThrow(/--undo first/);
  });
});
