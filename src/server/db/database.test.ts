/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initDatabase,
  closeDatabase,
  insertAuditLog,
  getAuditLogs,
  getAllAuditLogsForVerification,
  insertReviewDecision,
  getReviewDecisions,
  createNewApiKey,
  getApiKeyBySecret,
  saveDbSessionState,
  loadDbSessionState,
  getDb,
  insertGatewayEscalation,
  getPendingGatewayEscalations,
  saveBaselineState,
  loadBaselineState,
  DuplicateReviewDecisionError,
} from './database.js';
import { DEMO_API_KEY } from '../config.js';
import { verifyAuditChain } from './auditChain.js';
import type { EvaluationResult, ReviewDecision, SyntheticInteraction } from '../../types.js';

describe('Database Adapter (better-sqlite3)', () => {
  beforeEach(() => {
    // In-memory test database for isolation
    initDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase();
  });

  it('inserts and verifies chained audit logs', () => {
    const interaction: SyntheticInteraction = {
      id: 'int-test-1',
      use_case: 'support_bot',
      session_id: 'sess-1',
      turn_number: 1,
      query_type: 'refund_policy',
      prompt: 'Can I get a refund?',
      retrieved_context: 'Refunds within 30 days',
      response: 'Yes, full refunds are available within 30 days.',
      token_count: { prompt: 10, completion: 15, total: 25 },
      latency_ms: 120,
      ground_truth_labels: ['clean'],
      metadata: {},
    };

    const evaluation: EvaluationResult = {
      interaction_id: 'int-test-1',
      use_case: 'support_bot',
      timestamp: new Date().toISOString(),
      performance: {
        lane: 'performance',
        groundedness_score: 0.95,
        certainty_score: 0.5,
        certainty_support_mismatch: 0.0,
        is_confidently_wrong: false,
        is_ambiguous: false,
        needs_judge_call: false,
        risk_score: 0.05,
        triggering_spans: [],
        explanation: 'Well grounded',
      },
      cost: {
        lane: 'cost',
        token_z_score: 0.1,
        latency_z_score: 0.2,
        combined_z_score: 0.2,
        baseline_mean_tokens: 150,
        baseline_mean_latency_ms: 300,
        is_outlier: false,
        is_runaway_loop: false,
        risk_score: 0.05,
        explanation: 'Normal',
      },
      responsibility: {
        lane: 'responsibility',
        pii_detected: [],
        pii_score: 0,
        redacted_response: interaction.response,
        toxicity_score: 0,
        bias_flags: [],
        policy_violations: [],
        risk_score: 0,
        triggering_spans: [],
        explanation: 'No PII',
      },
      composite_risk_score: 0.05,
      session_accumulated_risk: 0.05,
      verdict: 'ALLOW',
      has_multi_lane_overlap: false,
      overlapping_lanes: [],
      added_overhead_latency_ms: 4,
      is_pre_response_blocked: false,
      policy_profile_version: '2.4.1',
      is_flagged_for_review: false,
    };

    // Insert 2 records to test chaining
    insertAuditLog(interaction, evaluation);
    insertAuditLog(
      { ...interaction, id: 'int-test-2' },
      { ...evaluation, interaction_id: 'int-test-2' },
    );

    const logs = getAuditLogs(10, 0);
    expect(logs).toHaveLength(2);

    // Verify cryptographic chain
    const allAsc = getAllAuditLogsForVerification();
    const chainCheck = verifyAuditChain(allAsc);
    expect(chainCheck.valid).toBe(true);
    expect(chainCheck.totalVerified).toBe(2);
  });

  it('persists and retrieves HITL review decisions', () => {
    const decision: ReviewDecision = {
      id: 'rev-1',
      interaction_id: 'int-test-1',
      reviewer: 'compliance_officer_alice',
      action: 'CONFIRM_BLOCK',
      notes: 'Customer data leak confirmed by human review',
      original_verdict: 'BLOCK_ESCALATE',
      new_verdict: 'BLOCK_ESCALATE',
      primary_trigger_lane: 'Responsibility',
      reviewed_at: new Date().toISOString(),
    };

    insertReviewDecision(decision);
    const retrieved = getReviewDecisions('int-test-1');
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0].reviewer).toBe('compliance_officer_alice');
    expect(retrieved[0].action).toBe('CONFIRM_BLOCK');

    // A correction is a new decision; the latest one is returned first
    insertReviewDecision({ ...decision, id: 'rev-1b', action: 'OVERRIDE_ALLOW' });
    const history = getReviewDecisions('int-test-1');
    expect(history.map((d) => d.id)).toEqual(['rev-1b', 'rev-1']);
  });

  function makeDecision(overrides: Partial<ReviewDecision> = {}): ReviewDecision {
    return {
      id: 'rev-x',
      interaction_id: 'int-x',
      reviewer: 'alice',
      action: 'CONFIRM_BLOCK',
      notes: '',
      original_verdict: 'BLOCK_ESCALATE',
      new_verdict: 'BLOCK_ESCALATE',
      primary_trigger_lane: 'Responsibility',
      reviewed_at: new Date().toISOString(),
      ...overrides,
    };
  }

  it('keeps review decisions append-only', () => {
    const decision = makeDecision({ id: 'rev-immutable', interaction_id: 'int-immutable' });
    insertReviewDecision(decision);

    // Re-inserting the same ID cannot overwrite the original
    expect(() => insertReviewDecision({ ...decision, action: 'OVERRIDE_ALLOW' })).toThrow(
      DuplicateReviewDecisionError,
    );
    // Triggers block UPDATE and DELETE even for direct SQL
    expect(() =>
      getDb().prepare(`UPDATE review_decisions SET action = 'OVERRIDE_ALLOW'`).run(),
    ).toThrow(/append-only/);
    expect(() => getDb().prepare('DELETE FROM review_decisions').run()).toThrow(/append-only/);
    expect(getReviewDecisions('int-immutable')[0].action).toBe('CONFIRM_BLOCK');
  });

  it('keeps the audit log append-only', () => {
    getDb()
      .prepare(
        `INSERT INTO audit_log (id, interaction_id, timestamp, request_hash, response_hash, verdict,
          composite_risk_score, session_risk, log_hmac) VALUES ('a1','i1','t','r','r','ALLOW',0,0,'h')`,
      )
      .run();
    expect(() => getDb().prepare('DELETE FROM audit_log').run()).toThrow(/append-only/);
    expect(() => getDb().prepare(`UPDATE audit_log SET verdict = 'X'`).run()).toThrow(
      /append-only/,
    );
  });

  it('scopes review decisions by tenant', () => {
    insertReviewDecision(makeDecision({ id: 'rev-a', interaction_id: 'int-a' }), {
      orgId: 'org_a',
      workspaceId: 'ws1',
    });
    insertReviewDecision(makeDecision({ id: 'rev-b', interaction_id: 'int-b' }), {
      orgId: 'org_b',
      workspaceId: 'ws1',
    });
    insertReviewDecision(makeDecision({ id: 'rev-a2', interaction_id: 'int-a2' }), {
      orgId: 'org_a',
      workspaceId: 'ws2',
    });

    const orgA = getReviewDecisions(undefined, { orgId: 'org_a' }).map((d) => d.id);
    expect(orgA.sort()).toEqual(['rev-a', 'rev-a2']);
    const orgAws2 = getReviewDecisions(undefined, { orgId: 'org_a', workspaceId: 'ws2' });
    expect(orgAws2.map((d) => d.id)).toEqual(['rev-a2']);
    expect(getReviewDecisions()).toHaveLength(3);
  });

  it('returns only unreviewed escalations for the tenant', () => {
    insertGatewayEscalation('gw-1', { orgId: 'org_a', workspaceId: 'ws' }, '{"id":1}');
    insertGatewayEscalation('gw-2', { orgId: 'org_a', workspaceId: 'ws' }, '{"id":2}');
    insertGatewayEscalation('gw-3', { orgId: 'org_b', workspaceId: 'ws' }, '{"id":3}');

    expect(getPendingGatewayEscalations(10, { orgId: 'org_a' })).toEqual(['{"id":1}', '{"id":2}']);

    insertReviewDecision(makeDecision({ id: 'rev-gw-1', interaction_id: 'gw-1' }), {
      orgId: 'org_a',
      workspaceId: 'ws',
    });
    expect(getPendingGatewayEscalations(10, { orgId: 'org_a' })).toEqual(['{"id":2}']);
    expect(getPendingGatewayEscalations(10)).toEqual(['{"id":2}', '{"id":3}']);
  });

  it('persists versioned baseline snapshots', () => {
    expect(loadBaselineState()).toBeNull();
    saveBaselineState(2, '{"a":1}');
    saveBaselineState(2, '{"a":2}');
    expect(loadBaselineState()).toEqual({ schemaVersion: 2, stateJson: '{"a":2}' });
  });

  it('creates and authenticates API keys', () => {
    const { rawKey, keyInfo } = createNewApiKey(
      'acme_corp',
      'ws_prod',
      'Acme Support Key',
      'support_bot',
      250,
    );
    expect(rawKey).toMatch(/^cp_live_[a-f0-9]{48}$/);
    expect(keyInfo.org_id).toBe('acme_corp');

    const authenticated = getApiKeyBySecret(rawKey);
    expect(authenticated).not.toBeNull();
    expect(authenticated?.org_id).toBe('acme_corp');
    expect(authenticated?.rate_limit_rpm).toBe(250);
    // Least privilege by default
    expect(authenticated?.role).toBe('service');

    const reviewerKey = createNewApiKey('acme_corp', 'ws_prod', '', 'support_bot', 10, 'reviewer');
    expect(getApiKeyBySecret(reviewerKey.rawKey)?.role).toBe('reviewer');

    // Bad key returns null
    expect(getApiKeyBySecret('cp_live_invalid_key_xyz')).toBeNull();
  });

  it('only accepts the hard-coded demo key in dev auth mode', () => {
    // Test runs are in dev mode (NODE_ENV=test, no CONTROLPLANE_AUTH_MODE)
    expect(getApiKeyBySecret(DEMO_API_KEY)?.role).toBe('admin');

    process.env.CONTROLPLANE_AUTH_MODE = 'required';
    try {
      initDatabase(':memory:');
      expect(getApiKeyBySecret(DEMO_API_KEY)).toBeNull();
    } finally {
      delete process.env.CONTROLPLANE_AUTH_MODE;
    }
  });

  it('seeds a bootstrap admin key from the environment', () => {
    process.env.CONTROLPLANE_AUTH_MODE = 'required';
    process.env.CONTROLPLANE_BOOTSTRAP_ADMIN_KEY = 'cp_live_bootstrap_test_key_0123456789';
    try {
      initDatabase(':memory:');
      expect(getApiKeyBySecret('cp_live_bootstrap_test_key_0123456789')?.role).toBe('admin');
    } finally {
      delete process.env.CONTROLPLANE_AUTH_MODE;
      delete process.env.CONTROLPLANE_BOOTSTRAP_ADMIN_KEY;
    }
  });

  it('saves and loads session state across restarts', () => {
    const state = {
      events: [{ risk: 0.4, turnNumber: 1, timestamp: 1000 }],
      currentRisk: 0.4,
    };

    saveDbSessionState('user-session-123', state);
    const loaded = loadDbSessionState('user-session-123');

    expect(loaded).toEqual(state);
    expect(loadDbSessionState('non-existent')).toBeNull();
  });
});
