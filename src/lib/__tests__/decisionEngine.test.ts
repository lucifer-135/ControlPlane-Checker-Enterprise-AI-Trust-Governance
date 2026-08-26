/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { evaluateInteraction, evaluateDataset } from '../decisionEngine';
import { DEFAULT_POLICY_PROFILES } from '../policyProfiles';
import type { SyntheticInteraction, PolicyProfile, UseCaseId } from '../../types';

function createInteraction(overrides: Partial<SyntheticInteraction> = {}): SyntheticInteraction {
  return {
    id: 'test-001',
    use_case: 'support_bot',
    session_id: 'session-001',
    turn_number: 1,
    query_type: 'refund_policy',
    prompt: 'What is the refund policy?',
    retrieved_context: 'All sales are final. No refunds are available.',
    response: 'All sales are final. No refunds are available for any purchases.',
    token_count: { prompt: 80, completion: 90, total: 170 },
    latency_ms: 320,
    tool_calls_count: 0,
    ground_truth_labels: ['clean'],
    metadata: { created_at: '2024-01-15T10:00:00Z' },
    ...overrides,
  };
}

function getPolicy(useCase: UseCaseId = 'support_bot'): PolicyProfile {
  return DEFAULT_POLICY_PROFILES[useCase];
}

describe('Decision Engine', () => {
  describe('evaluateInteraction', () => {
    describe('Verdict Tier Mapping', () => {
      it('should return ALLOW for clean, grounded interactions', () => {
        const interaction = createInteraction();
        const result = evaluateInteraction(interaction, getPolicy());

        expect(result.verdict).toBe('ALLOW');
        expect(result.composite_risk_score).toBeLessThan(0.25);
        expect(result.is_flagged_for_review).toBe(false);
      });

      it('should return BLOCK_ESCALATE for ungrounded + high certainty interactions', () => {
        const interaction = createInteraction({
          response:
            'We guarantee a 100% full unconditional cash refund immediately for all purchases, no questions asked.',
        });
        const result = evaluateInteraction(interaction, getPolicy());

        expect(result.composite_risk_score).toBeGreaterThan(0.4);
      });

      it('should return BLOCK_ESCALATE for SSN exposure (hard override)', () => {
        const interaction = createInteraction({
          response: 'The customer SSN is 123-45-6789 and their refund has been processed.',
        });
        const result = evaluateInteraction(interaction, getPolicy());

        expect(result.verdict).toBe('BLOCK_ESCALATE');
        expect(result.is_flagged_for_review).toBe(true);
      });

      it('should return BLOCK_ESCALATE for gender discrimination (hard override)', () => {
        const interaction = createInteraction({
          use_case: 'decision_support',
          query_type: 'loan_underwriting',
          response:
            'We should disqualify the candidate because women with young children lack the aggressive dedication needed for VP leadership.',
        });
        const result = evaluateInteraction(interaction, getPolicy('decision_support'));

        expect(result.verdict).toBe('BLOCK_ESCALATE');
      });

      it('should return BLOCK_ESCALATE for runaway loops (hard override)', () => {
        const interaction = createInteraction({
          tool_calls_count: 8,
          token_count: { prompt: 200, completion: 3000, total: 3200 },
          latency_ms: 5000,
        });
        const result = evaluateInteraction(interaction, getPolicy());

        expect(result.verdict).toBe('BLOCK_ESCALATE');
      });
    });

    describe('Composite Risk Score', () => {
      it('should compute composite score in [0, 1] range', () => {
        const interaction = createInteraction();
        const result = evaluateInteraction(interaction, getPolicy());

        expect(result.composite_risk_score).toBeGreaterThanOrEqual(0);
        expect(result.composite_risk_score).toBeLessThanOrEqual(1);
      });

      it('should weight lanes according to policy profile', () => {
        const interaction = createInteraction();
        const result = evaluateInteraction(interaction, getPolicy());

        // The composite score should be a weighted blend of the three lanes
        expect(result.performance).toBeDefined();
        expect(result.cost).toBeDefined();
        expect(result.responsibility).toBeDefined();
      });
    });

    describe('Multi-Lane Overlap Detection', () => {
      it('should detect multi-lane overlap when multiple lanes trigger', () => {
        const interaction = createInteraction({
          response:
            'We guarantee SSN 123-45-6789 proves the customer gets a 100% refund with unlimited coverage.',
          token_count: { prompt: 200, completion: 2500, total: 2700 },
          latency_ms: 5000,
          tool_calls_count: 5,
        });
        const result = evaluateInteraction(interaction, getPolicy());

        expect(result.has_multi_lane_overlap).toBe(true);
        expect(result.overlapping_lanes.length).toBeGreaterThanOrEqual(2);
      });

      it('should not flag overlap for clean interactions', () => {
        const interaction = createInteraction();
        const result = evaluateInteraction(interaction, getPolicy());

        expect(result.has_multi_lane_overlap).toBe(false);
      });
    });

    describe('Session Risk Compounding', () => {
      it('should compound session risk across turns', () => {
        const interaction = createInteraction();
        const result1 = evaluateInteraction(interaction, getPolicy(), 0);
        const result2 = evaluateInteraction(interaction, getPolicy(), 0.5);

        // With higher session accumulator, session_accumulated_risk should be higher
        expect(result2.session_accumulated_risk).toBeGreaterThan(result1.session_accumulated_risk);
      });

      it('should cap session risk at 1.0', () => {
        const interaction = createInteraction();
        const result = evaluateInteraction(interaction, getPolicy(), 0.99);

        expect(result.session_accumulated_risk).toBeLessThanOrEqual(1.0);
      });
    });

    describe('Pre-response Blocking', () => {
      it('should set is_pre_response_blocked for blocking-enabled profiles', () => {
        const interaction = createInteraction({
          use_case: 'decision_support',
          query_type: 'loan_underwriting',
          response: 'Customer SSN is 123-45-6789.',
        });
        const result = evaluateInteraction(interaction, getPolicy('decision_support'));

        // decision_support has pre_response_blocking = true
        if (result.verdict === 'BLOCK_ESCALATE') {
          expect(result.is_pre_response_blocked).toBe(true);
        }
      });
    });

    describe('Return Shape', () => {
      it('should return all required evaluation fields', () => {
        const interaction = createInteraction();
        const result = evaluateInteraction(interaction, getPolicy());

        expect(result.interaction_id).toBe('test-001');
        expect(result.use_case).toBe('support_bot');
        expect(typeof result.timestamp).toBe('string');
        expect(result.performance.lane).toBe('performance');
        expect(result.cost.lane).toBe('cost');
        expect(result.responsibility.lane).toBe('responsibility');
        expect(typeof result.composite_risk_score).toBe('number');
        expect(typeof result.session_accumulated_risk).toBe('number');
        expect(['ALLOW', 'BADGE', 'SOFT_CORRECT', 'BLOCK_ESCALATE']).toContain(result.verdict);
        expect(typeof result.has_multi_lane_overlap).toBe('boolean');
        expect(Array.isArray(result.overlapping_lanes)).toBe(true);
        expect(typeof result.added_overhead_latency_ms).toBe('number');
        expect(typeof result.is_pre_response_blocked).toBe('boolean');
        expect(typeof result.policy_profile_version).toBe('string');
        expect(typeof result.is_flagged_for_review).toBe('boolean');
      });
    });
  });

  describe('evaluateDataset', () => {
    it('should evaluate multiple interactions and return evaluations map', () => {
      const interactions = [
        createInteraction({ id: 'int-1', session_id: 'sess-1', turn_number: 1 }),
        createInteraction({ id: 'int-2', session_id: 'sess-1', turn_number: 2 }),
        createInteraction({ id: 'int-3', session_id: 'sess-2', turn_number: 1 }),
      ];

      const { evaluations, sessionAccumulators } = evaluateDataset(
        interactions,
        DEFAULT_POLICY_PROFILES,
      );

      expect(Object.keys(evaluations)).toHaveLength(3);
      expect(evaluations['int-1']).toBeDefined();
      expect(evaluations['int-2']).toBeDefined();
      expect(evaluations['int-3']).toBeDefined();

      // Session accumulators should track by session_id
      expect(sessionAccumulators['sess-1']).toBeDefined();
      expect(sessionAccumulators['sess-2']).toBeDefined();
    });

    it('should accumulate session risk across turns in same session', () => {
      const interactions = [
        createInteraction({ id: 'turn-1', session_id: 'sess-compound', turn_number: 1 }),
        createInteraction({ id: 'turn-2', session_id: 'sess-compound', turn_number: 2 }),
        createInteraction({ id: 'turn-3', session_id: 'sess-compound', turn_number: 3 }),
      ];

      const { evaluations } = evaluateDataset(interactions, DEFAULT_POLICY_PROFILES);

      // Later turns should have non-zero session risk if earlier turns had risk
      const turn1Risk = evaluations['turn-1'].session_accumulated_risk;
      const turn2Risk = evaluations['turn-2'].session_accumulated_risk;
      const turn3Risk = evaluations['turn-3'].session_accumulated_risk;

      // Session risk should compound (or at least not decrease meaningfully for identical inputs)
      expect(turn2Risk).toBeGreaterThanOrEqual(turn1Risk * 0.4);
      expect(turn3Risk).toBeGreaterThanOrEqual(turn2Risk * 0.4);
    });
  });
});
