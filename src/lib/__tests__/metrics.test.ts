/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  computeConfusionMatrix,
  isGroundTruthViolating,
  getConfusionMatrixItems,
} from '../metrics';
import { evaluateDataset } from '../decisionEngine';
import { DEFAULT_POLICY_PROFILES } from '../policyProfiles';
import type { SyntheticInteraction } from '../../types';

function createInteraction(
  id: string,
  labels: SyntheticInteraction['ground_truth_labels'],
  response: string = 'Normal response.',
  overrides: Partial<SyntheticInteraction> = {},
): SyntheticInteraction {
  return {
    id,
    use_case: 'support_bot',
    session_id: `session-${id}`,
    turn_number: 1,
    query_type: 'refund_policy',
    prompt: 'Test prompt',
    retrieved_context: 'Test context for grounding.',
    response,
    token_count: { prompt: 80, completion: 90, total: 170 },
    latency_ms: 320,
    tool_calls_count: 0,
    ground_truth_labels: labels,
    metadata: { created_at: '2024-01-15T10:00:00Z' },
    ...overrides,
  };
}

describe('Metrics', () => {
  describe('isGroundTruthViolating', () => {
    it('should return false for clean labels', () => {
      const interaction = createInteraction('clean-1', ['clean']);
      expect(isGroundTruthViolating(interaction)).toBe(false);
    });

    it('should return true for hallucinated labels', () => {
      const interaction = createInteraction('hall-1', ['hallucinated']);
      expect(isGroundTruthViolating(interaction)).toBe(true);
    });

    it('should return true for pii_leaking labels', () => {
      const interaction = createInteraction('pii-1', ['pii_leaking']);
      expect(isGroundTruthViolating(interaction)).toBe(true);
    });

    it('should return true for mixed labels including non-clean', () => {
      const interaction = createInteraction('mixed-1', ['clean', 'biased_toxic']);
      expect(isGroundTruthViolating(interaction)).toBe(true);
    });

    it('should return true for cost_outlier labels', () => {
      const interaction = createInteraction('cost-1', ['cost_outlier']);
      expect(isGroundTruthViolating(interaction)).toBe(true);
    });
  });

  describe('computeConfusionMatrix', () => {
    it('should compute correct matrix for simple dataset', () => {
      const interactions = [
        // True violation, should be blocked (TP)
        createInteraction('tp-1', ['pii_leaking'], 'Customer SSN is 123-45-6789'),
        // Clean, should not be blocked (TN)
        createInteraction('tn-1', ['clean'], 'Your order ships in 3-5 days.'),
        // Clean, should not be blocked (TN)
        createInteraction('tn-2', ['clean'], 'The product comes in blue and red.'),
      ];

      const { evaluations } = evaluateDataset(interactions, DEFAULT_POLICY_PROFILES);
      const matrix = computeConfusionMatrix(interactions, evaluations);

      expect(matrix.total_evaluated).toBe(3);
      expect(
        matrix.true_positives +
          matrix.false_positives +
          matrix.true_negatives +
          matrix.false_negatives,
      ).toBe(3);

      // Basic sanity: precision, recall, accuracy should be numbers
      expect(typeof matrix.precision).toBe('number');
      expect(typeof matrix.recall).toBe('number');
      expect(typeof matrix.f1_score).toBe('number');
      expect(typeof matrix.accuracy).toBe('number');
    });

    it('should filter by use case when specified', () => {
      const interactions = [
        createInteraction('sb-1', ['clean'], 'Safe response.', { use_case: 'support_bot' }),
        createInteraction('ds-1', ['clean'], 'Safe response.', {
          use_case: 'decision_support',
          query_type: 'loan_underwriting',
        }),
      ];

      const { evaluations } = evaluateDataset(interactions, DEFAULT_POLICY_PROFILES);
      const matrix = computeConfusionMatrix(interactions, evaluations, 'support_bot');

      expect(matrix.total_evaluated).toBe(1);
    });

    it('should compute valid precision and recall percentages', () => {
      const interactions = [
        createInteraction('v1', ['hallucinated'], 'We guarantee 100% unlimited refunds.'),
        createInteraction('v2', ['pii_leaking'], 'SSN: 123-45-6789'),
        createInteraction('c1', ['clean'], 'Normal safe response.'),
      ];

      const { evaluations } = evaluateDataset(interactions, DEFAULT_POLICY_PROFILES);
      const matrix = computeConfusionMatrix(interactions, evaluations);

      expect(matrix.precision).toBeGreaterThanOrEqual(0);
      expect(matrix.precision).toBeLessThanOrEqual(100);
      expect(matrix.recall).toBeGreaterThanOrEqual(0);
      expect(matrix.recall).toBeLessThanOrEqual(100);
      expect(matrix.f1_score).toBeGreaterThanOrEqual(0);
      expect(matrix.f1_score).toBeLessThanOrEqual(100);
    });
  });

  describe('getConfusionMatrixItems', () => {
    it('should categorize interactions into TP, FP, TN, FN buckets', () => {
      const interactions = [
        createInteraction('item-1', ['clean'], 'Safe.'),
        createInteraction('item-2', ['pii_leaking'], 'SSN: 123-45-6789'),
      ];

      const { evaluations } = evaluateDataset(interactions, DEFAULT_POLICY_PROFILES);
      const { TP, FP, TN, FN } = getConfusionMatrixItems(interactions, evaluations);

      const total = TP.length + FP.length + TN.length + FN.length;
      expect(total).toBe(2);
    });
  });

  describe('Confusion Matrix Return Shape', () => {
    it('should return all required fields', () => {
      const interactions = [createInteraction('shape-1', ['clean'], 'Safe.')];
      const { evaluations } = evaluateDataset(interactions, DEFAULT_POLICY_PROFILES);
      const matrix = computeConfusionMatrix(interactions, evaluations);

      expect(typeof matrix.true_positives).toBe('number');
      expect(typeof matrix.false_positives).toBe('number');
      expect(typeof matrix.true_negatives).toBe('number');
      expect(typeof matrix.false_negatives).toBe('number');
      expect(typeof matrix.precision).toBe('number');
      expect(typeof matrix.recall).toBe('number');
      expect(typeof matrix.f1_score).toBe('number');
      expect(typeof matrix.accuracy).toBe('number');
      expect(typeof matrix.fp_rate).toBe('number');
      expect(typeof matrix.fn_rate).toBe('number');
      expect(typeof matrix.total_evaluated).toBe('number');
    });
  });
});
