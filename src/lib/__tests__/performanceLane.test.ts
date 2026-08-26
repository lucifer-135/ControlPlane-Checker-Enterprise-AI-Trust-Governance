/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { evaluatePerformanceLane } from '../lanes/performanceLane';

describe('Performance Lane Evaluator', () => {
  describe('Groundedness Scoring', () => {
    it('should return high groundedness when response closely matches context', () => {
      const result = evaluatePerformanceLane(
        'What is the refund policy?',
        'Our refund policy allows returns within 30 days of purchase with a valid receipt.',
        'Our refund policy allows returns within 30 days of purchase with a valid receipt.',
        'support_bot',
      );

      expect(result.groundedness_score).toBeGreaterThan(0.6);
      expect(result.risk_score).toBeLessThan(0.5);
      expect(result.is_confidently_wrong).toBe(false);
    });

    it('should return low groundedness when response has no overlap with context', () => {
      const result = evaluatePerformanceLane(
        'What is the refund policy?',
        'Our refund policy allows returns within 30 days of purchase.',
        'The quantum entanglement protocol requires hyperspace calibration for all photon emissions.',
        'support_bot',
      );

      expect(result.groundedness_score).toBeLessThan(0.4);
      expect(result.risk_score).toBeGreaterThan(0.5);
    });

    it('should handle null retrieved context gracefully', () => {
      const result = evaluatePerformanceLane(
        'What is the weather?',
        null,
        'The weather today is sunny and warm.',
        'support_bot',
      );

      expect(result.lane).toBe('performance');
      expect(result.groundedness_score).toBeGreaterThan(0);
      expect(result.risk_score).toBeDefined();
    });

    it('should handle empty retrieved context', () => {
      const result = evaluatePerformanceLane(
        'Tell me about the product.',
        '   ',
        'This product is amazing and reliable.',
        'support_bot',
      );

      // Empty context should behave similarly to null context
      expect(result.groundedness_score).toBeGreaterThan(0);
    });
  });

  describe('Certainty Detection', () => {
    it('should detect high certainty phrases and raise certainty score', () => {
      const result = evaluatePerformanceLane(
        'Is this guaranteed?',
        'We offer a limited warranty.',
        'This is guaranteed to work with 100% certainty and proven to be effective.',
        'support_bot',
      );

      expect(result.certainty_score).toBeGreaterThan(0.7);
      expect(result.triggering_spans.length).toBeGreaterThan(0);
    });

    it('should detect hedging phrases and lower certainty score', () => {
      const result = evaluatePerformanceLane(
        'What about the warranty?',
        'Limited warranty applies.',
        'It might be covered, according to documentation, but it is suggested you verify.',
        'support_bot',
      );

      expect(result.certainty_score).toBeLessThan(0.5);
    });
  });

  describe('Confidently Wrong Detection', () => {
    it('should flag "confidently wrong" when high certainty + low groundedness', () => {
      const result = evaluatePerformanceLane(
        'What is the refund policy?',
        'All sales are strictly non-refundable under any circumstances.',
        'We guarantee a 100% full unconditional cash refund immediately for all purchases, no questions asked.',
        'support_bot',
      );

      expect(result.is_confidently_wrong).toBe(true);
      expect(result.certainty_support_mismatch).toBeGreaterThan(0.5);
      expect(result.risk_score).toBeGreaterThan(0.7);
    });

    it('should not flag well-grounded confident statements', () => {
      const result = evaluatePerformanceLane(
        'What is the policy?',
        'Our policy guarantees 24-hour support response times for all enterprise customers.',
        'Our policy guarantees 24-hour support response times for enterprise customers.',
        'support_bot',
      );

      expect(result.is_confidently_wrong).toBe(false);
    });
  });

  describe('Ambiguous Grounding & Judge Escalation', () => {
    it('should mark ambiguous when groundedness is in the 0.35–0.65 range', () => {
      const result = evaluatePerformanceLane(
        'What are the backup procedures?',
        'Backups run every 15 minutes using encrypted cloud storage.',
        'Backups are performed regularly using modern cloud infrastructure for data protection.',
        'support_bot',
      );

      // If groundedness falls in ambiguous range
      if (result.groundedness_score >= 0.35 && result.groundedness_score <= 0.65) {
        expect(result.is_ambiguous).toBe(true);
        expect(result.needs_judge_call).toBe(true);
      }
    });
  });

  describe('Ungrounded Number Detection', () => {
    it('should flag numbers in response that are absent from context', () => {
      const result = evaluatePerformanceLane(
        'What is the cost?',
        'The standard plan costs $49 per month.',
        'The premium plan costs $199 per month with a $500 setup fee.',
        'support_bot',
      );

      const numberSpans = result.triggering_spans.filter(
        (s) => s.type === 'hallucination' && s.reason.includes('not present'),
      );
      expect(numberSpans.length).toBeGreaterThan(0);
    });
  });

  describe('Return Shape', () => {
    it('should return all required fields with correct types', () => {
      const result = evaluatePerformanceLane(
        'Test prompt',
        'Test context',
        'Test response',
        'support_bot',
      );

      expect(result.lane).toBe('performance');
      expect(typeof result.groundedness_score).toBe('number');
      expect(typeof result.certainty_score).toBe('number');
      expect(typeof result.certainty_support_mismatch).toBe('number');
      expect(typeof result.is_confidently_wrong).toBe('boolean');
      expect(typeof result.is_ambiguous).toBe('boolean');
      expect(typeof result.needs_judge_call).toBe('boolean');
      expect(typeof result.risk_score).toBe('number');
      expect(Array.isArray(result.triggering_spans)).toBe(true);
      expect(typeof result.explanation).toBe('string');

      // Scores must be in [0, 1] range
      expect(result.groundedness_score).toBeGreaterThanOrEqual(0);
      expect(result.groundedness_score).toBeLessThanOrEqual(1);
      expect(result.certainty_score).toBeGreaterThanOrEqual(0);
      expect(result.certainty_score).toBeLessThanOrEqual(1);
      expect(result.risk_score).toBeGreaterThanOrEqual(0);
      expect(result.risk_score).toBeLessThanOrEqual(1);
    });
  });
});
