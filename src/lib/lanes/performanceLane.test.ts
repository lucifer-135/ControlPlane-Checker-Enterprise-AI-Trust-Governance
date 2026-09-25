/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { evaluatePerformanceLane, UNGROUNDED_CUTOFF_PENALTY } from './performanceLane';

describe('evaluatePerformanceLane', () => {
  describe('groundedness scoring (generalized, no hardcoded strings)', () => {
    it('scores a well-grounded response highly', () => {
      const result = evaluatePerformanceLane(
        'What is the refund policy?',
        'Annual subscriptions are eligible for prorated refund within 30 days.',
        'You can get a prorated refund for your annual subscription within the first 30 days.',
        'support_bot',
      );
      expect(result.groundedness_score).toBeGreaterThan(0.3);
      expect(result.is_confidently_wrong).toBe(false);
    });

    it('detects contradiction when response opposes context', () => {
      const result = evaluatePerformanceLane(
        'Is a refund possible?',
        'Quarterly plans are strictly non-refundable after 14 days of activation.',
        'I guarantee a 100% full unconditional cash refund immediately. No questions asked.',
        'support_bot',
      );
      expect(result.groundedness_score).toBeLessThan(0.4);
      expect(result.risk_score).toBeGreaterThan(0.5);
    });

    it('detects fabricated entities not in context', () => {
      const result = evaluatePerformanceLane(
        'What regulation covers this?',
        'Tier-3 biotech applicants require additional documentation per internal review.',
        'Federal Reserve Regulation 99.4 explicitly mandates that all Tier-3 biotech applicants are guaranteed approval.',
        'decision_support',
      );
      // Should detect ungrounded regulation reference
      expect(result.triggering_spans.length).toBeGreaterThan(0);
      expect(result.groundedness_score).toBeLessThan(0.55);
    });

    it('detects security contradiction (encrypted vs unencrypted)', () => {
      const result = evaluatePerformanceLane(
        'What protocol should we use?',
        'All API traffic must use TLS 1.3 encryption on port 443.',
        'The system allows unencrypted plaintext HTTP traffic on port 80 for maximum compatibility.',
        'internal_copilot',
      );
      expect(result.groundedness_score).toBeLessThan(0.35);
      expect(result.triggering_spans.some((s) => s.type === 'hallucination')).toBe(true);
    });

    it('handles novel contradiction not in original demo dataset', () => {
      // This test proves the system works on arbitrary inputs, not just demo data
      const result = evaluatePerformanceLane(
        'Is the service available 24/7?',
        'Support is available Monday through Friday, 9am to 5pm EST. Weekend support requires a premium plan upgrade.',
        'Our support is definitely available 24/7 with guaranteed unlimited access at no additional cost whatsoever.',
        'support_bot',
      );
      expect(result.certainty_score).toBeGreaterThan(0.6);
      expect(result.groundedness_score).toBeLessThan(0.65);
    });
  });

  describe('certainty scoring', () => {
    it('assigns high certainty to assertive language', () => {
      const result = evaluatePerformanceLane(
        'Is this covered?',
        'Coverage depends on multiple factors.',
        'This is absolutely, 100% guaranteed to be covered without exception.',
        'support_bot',
      );
      expect(result.certainty_score).toBeGreaterThan(0.7);
    });

    it('assigns low certainty to hedging language', () => {
      const result = evaluatePerformanceLane(
        'Is this covered?',
        'Coverage depends on multiple factors.',
        'Based on the provided documentation, it appears that coverage may require additional review. Please verify with your plan details.',
        'support_bot',
      );
      expect(result.certainty_score).toBeLessThan(0.5);
    });
  });

  describe('no context scenario', () => {
    it('applies conservative grounding when no context is available', () => {
      const result = evaluatePerformanceLane(
        'Tell me about quantum computing',
        null,
        'Quantum computing leverages quantum mechanics principles for computation.',
        'support_bot',
      );
      // Without context, should rely on certainty calibration
      expect(result.groundedness_score).toBeGreaterThan(0.3);
    });
  });
});

describe('Performance lane hallucination cutoff', () => {
  it('adds the ungrounded penalty only when groundedness is below the policy cutoff', () => {
    const prompt = 'What is the refund window?';
    const context = 'Refunds are available within 30 days of purchase with a receipt.';
    const response = 'Refunds are possibly available for some purchases, depending on the store.';

    const lenient = evaluatePerformanceLane(prompt, context, response, 'support_bot', 0.0);
    const strict = evaluatePerformanceLane(prompt, context, response, 'support_bot', 1.0);

    expect(strict.groundedness_score).toBe(lenient.groundedness_score);
    expect(strict.risk_score).toBeCloseTo(
      Math.min(1, lenient.risk_score + UNGROUNDED_CUTOFF_PENALTY),
      3,
    );
    expect(strict.explanation).toContain('policy cutoff');
  });
});
