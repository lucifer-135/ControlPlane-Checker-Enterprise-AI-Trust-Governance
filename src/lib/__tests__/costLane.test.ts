/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { evaluateCostLane } from '../lanes/costLane';
import type { TokenUsage } from '../../types';

describe('Cost Lane Evaluator', () => {
  const normalTokens: TokenUsage = { prompt: 80, completion: 90, total: 170 };
  const highTokens: TokenUsage = { prompt: 200, completion: 800, total: 1000 };
  const explosionTokens: TokenUsage = { prompt: 200, completion: 2500, total: 2700 };

  describe('Normal Resource Consumption', () => {
    it('should return low risk for normal token counts and latency', () => {
      const result = evaluateCostLane(normalTokens, 320, 'support_bot', 'refund_policy', 0, 2.0);

      expect(result.lane).toBe('cost');
      expect(result.is_outlier).toBe(false);
      expect(result.is_runaway_loop).toBe(false);
      expect(result.risk_score).toBeLessThan(0.5);
    });

    it('should calculate Z-scores relative to baselines', () => {
      const result = evaluateCostLane(normalTokens, 320, 'support_bot', 'refund_policy', 0, 2.0);

      expect(typeof result.token_z_score).toBe('number');
      expect(typeof result.latency_z_score).toBe('number');
      expect(typeof result.combined_z_score).toBe('number');
      expect(result.baseline_mean_tokens).toBeGreaterThan(0);
      expect(result.baseline_mean_latency_ms).toBeGreaterThan(0);
    });
  });

  describe('Outlier Detection', () => {
    it('should flag token outlier when Z-score exceeds cutoff', () => {
      const result = evaluateCostLane(highTokens, 320, 'support_bot', 'refund_policy', 0, 2.0);

      expect(result.is_outlier).toBe(true);
      expect(result.combined_z_score).toBeGreaterThanOrEqual(2.0);
      expect(result.risk_score).toBeGreaterThan(0.3);
    });

    it('should flag latency outlier when latency Z-score exceeds cutoff', () => {
      // Very high latency for a support bot query
      const result = evaluateCostLane(normalTokens, 5000, 'support_bot', 'refund_policy', 0, 2.0);

      expect(result.is_outlier).toBe(true);
      expect(result.latency_z_score).toBeGreaterThan(2.0);
    });

    it('should respect custom Z-score cutoff', () => {
      // Use moderate tokens that are outliers at cutoff=2 but not runaway loops
      const moderateTokens: TokenUsage = { prompt: 150, completion: 300, total: 450 };
      // With a very high cutoff, moderate outliers should pass
      const result = evaluateCostLane(moderateTokens, 500, 'support_bot', 'refund_policy', 0, 50.0);

      expect(result.is_outlier).toBe(false);
    });
  });

  describe('Runaway Loop Detection', () => {
    it('should flag runaway loop when tool calls >= 4', () => {
      const result = evaluateCostLane(normalTokens, 320, 'support_bot', 'refund_policy', 5, 2.0);

      expect(result.is_runaway_loop).toBe(true);
      expect(result.is_outlier).toBe(true);
      expect(result.risk_score).toBeGreaterThanOrEqual(0.9);
    });

    it('should flag runaway loop on token explosion (completion > 3.5x mean)', () => {
      const result = evaluateCostLane(
        explosionTokens,
        1000,
        'support_bot',
        'refund_policy',
        0,
        2.0,
      );

      expect(result.is_runaway_loop).toBe(true);
      expect(result.risk_score).toBeGreaterThanOrEqual(0.9);
    });

    it('should not flag runaway loop for normal tool call counts', () => {
      const result = evaluateCostLane(normalTokens, 320, 'support_bot', 'refund_policy', 2, 2.0);

      expect(result.is_runaway_loop).toBe(false);
    });
  });

  describe('Risk Score Normalization', () => {
    it('should produce risk scores in [0, 1] range', () => {
      const scenarios: [TokenUsage, number, number][] = [
        [normalTokens, 320, 0],
        [highTokens, 500, 1],
        [explosionTokens, 5000, 8],
      ];

      for (const [tokens, latency, tools] of scenarios) {
        const result = evaluateCostLane(tokens, latency, 'support_bot', 'refund_policy', tools);

        expect(result.risk_score).toBeGreaterThanOrEqual(0);
        expect(result.risk_score).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('Use Case Baselines', () => {
    it('should use different baselines for different use cases', () => {
      const supportResult = evaluateCostLane(
        { prompt: 200, completion: 300, total: 500 },
        800,
        'support_bot',
        'refund_policy',
        0,
      );
      const decisionResult = evaluateCostLane(
        { prompt: 200, completion: 300, total: 500 },
        800,
        'decision_support',
        'loan_underwriting',
        0,
      );

      // Same tokens/latency should produce different Z-scores for different use cases
      expect(supportResult.baseline_mean_tokens).not.toBe(decisionResult.baseline_mean_tokens);
    });
  });

  describe('Return Shape', () => {
    it('should return all required fields', () => {
      const result = evaluateCostLane(normalTokens, 320, 'support_bot', 'refund_policy', 0);

      expect(result.lane).toBe('cost');
      expect(typeof result.token_z_score).toBe('number');
      expect(typeof result.latency_z_score).toBe('number');
      expect(typeof result.combined_z_score).toBe('number');
      expect(typeof result.baseline_mean_tokens).toBe('number');
      expect(typeof result.baseline_mean_latency_ms).toBe('number');
      expect(typeof result.is_outlier).toBe('boolean');
      expect(typeof result.is_runaway_loop).toBe('boolean');
      expect(typeof result.risk_score).toBe('number');
      expect(typeof result.explanation).toBe('string');
    });
  });
});
