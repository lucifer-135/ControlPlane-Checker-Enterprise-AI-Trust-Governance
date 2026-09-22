/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDatabase,
  insertAuditLog,
  getAuditLogs,
  getAllAuditLogsForVerification,
  insertReviewDecision,
  getReviewDecisions,
  createNewApiKey,
  getApiKeyBySecret,
  saveDbSessionState,
  loadDbSessionState,
} from './database.js';
import { verifyAuditChain } from './auditChain.js';
import type { EvaluationResult, ReviewDecision, SyntheticInteraction } from '../../types.js';

describe('Database Adapter (better-sqlite3)', () => {
  beforeEach(() => {
    // In-memory test database for isolation
    initDatabase(':memory:');
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

    // Bad key returns null
    expect(getApiKeyBySecret('cp_live_invalid_key_xyz')).toBeNull();
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
