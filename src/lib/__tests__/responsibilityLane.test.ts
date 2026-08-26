/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { evaluateResponsibilityLane } from '../lanes/responsibilityLane';

describe('Responsibility Lane Evaluator', () => {
  describe('PII Detection — SSN', () => {
    it('should detect valid SSN patterns', () => {
      const result = evaluateResponsibilityLane(
        'The customer SSN is 123-45-6789 for reference.',
        'EU_AI_ACT_STANDARD',
      );

      expect(result.pii_detected.length).toBeGreaterThan(0);
      expect(result.pii_detected.some((p) => p.type === 'SSN')).toBe(true);
      expect(result.pii_score).toBeGreaterThan(0);
    });

    it('should redact SSN in the response', () => {
      const result = evaluateResponsibilityLane(
        'SSN: 123-45-6789',
        'EU_AI_ACT_STANDARD',
      );

      expect(result.redacted_response).toContain('[REDACTED_SSN]');
      expect(result.redacted_response).not.toContain('123-45-6789');
    });
  });

  describe('PII Detection — Email', () => {
    it('should detect email addresses', () => {
      const result = evaluateResponsibilityLane(
        'Contact john.doe@example.com for support.',
        'EU_AI_ACT_STANDARD',
      );

      expect(result.pii_detected.some((p) => p.type === 'EMAIL')).toBe(true);
      expect(result.redacted_response).toContain('[REDACTED_EMAIL]');
    });
  });

  describe('PII Detection — Credit Card', () => {
    it('should detect credit card number patterns', () => {
      const result = evaluateResponsibilityLane(
        'Payment processed with card 4111111111111111.',
        'US_HIPAA_FINRA',
      );

      expect(result.pii_detected.some((p) => p.type === 'CREDIT_CARD')).toBe(true);
    });
  });

  describe('PII Detection — Phone', () => {
    it('should detect phone number patterns', () => {
      const result = evaluateResponsibilityLane(
        'Call us at (555) 123-4567.',
        'EU_AI_ACT_STANDARD',
      );

      expect(result.pii_detected.some((p) => p.type === 'PHONE')).toBe(true);
    });
  });

  describe('Bias & Toxicity Detection', () => {
    it('should detect gender discrimination', () => {
      const result = evaluateResponsibilityLane(
        'We should disqualify the candidate because women with young children lack the aggressive dedication needed for VP leadership.',
        'US_HIPAA_FINRA',
      );

      expect(result.bias_flags).toContain('Gender Discrimination');
      expect(result.toxicity_score).toBeGreaterThanOrEqual(0.9);
      expect(result.risk_score).toBeGreaterThanOrEqual(0.9);
    });

    it('should detect xenophobic stereotypes', () => {
      const result = evaluateResponsibilityLane(
        'Foreign-born immigrant factory workers are statistically 40% more likely to fabricate industrial injury claims.',
        'EU_AI_ACT_STANDARD',
      );

      expect(result.bias_flags).toContain('Xenophobia / National Origin');
      expect(result.toxicity_score).toBeGreaterThanOrEqual(0.9);
    });

    it('should detect redlining violations', () => {
      const result = evaluateResponsibilityLane(
        'Zip code 90210 is a high-risk demographic neighborhood with historically higher default rates among minority populations.',
        'US_HIPAA_FINRA',
      );

      expect(result.bias_flags).toContain('Redlining & Fair Lending Violation');
    });

    it('should detect ageism', () => {
      const result = evaluateResponsibilityLane(
        'Old people over 65 clearly lack the basic cognitive ability to operate modern web apps.',
        'EU_AI_ACT_STANDARD',
      );

      expect(result.bias_flags).toContain('Ageism / Disability');
    });
  });

  describe('Geography Ruleset Policy Violations', () => {
    it('should flag EU AI Act violations for bias', () => {
      const result = evaluateResponsibilityLane(
        'Old people over 65 clearly lack the basic cognitive ability to operate modern web apps.',
        'EU_AI_ACT_STANDARD',
      );

      expect(result.policy_violations.some((v) => v.includes('EU AI Act'))).toBe(true);
    });

    it('should flag GDPR violations for PII exposure under EU ruleset', () => {
      const result = evaluateResponsibilityLane(
        'The employee email is jane@corp.com.',
        'EU_AI_ACT_STANDARD',
      );

      expect(result.policy_violations.some((v) => v.includes('GDPR'))).toBe(true);
    });

    it('should flag HIPAA/FINRA violations for SSN under US ruleset', () => {
      const result = evaluateResponsibilityLane(
        'Customer SSN: 123-45-6789',
        'US_HIPAA_FINRA',
      );

      expect(result.policy_violations.some((v) => v.includes('HIPAA') || v.includes('FINRA'))).toBe(
        true,
      );
    });

    it('should flag DPDPA violations for PII under India ruleset', () => {
      const result = evaluateResponsibilityLane(
        'Contact info: user@example.in',
        'INDIA_DPDP_ACT',
      );

      expect(result.policy_violations.some((v) => v.includes('DPDPA') || v.includes('Digital Personal Data'))).toBe(
        true,
      );
    });
  });

  describe('Clean Input', () => {
    it('should return clean results for safe responses', () => {
      const result = evaluateResponsibilityLane(
        'Your order has been shipped and will arrive in 3-5 business days.',
        'EU_AI_ACT_STANDARD',
      );

      expect(result.pii_detected).toHaveLength(0);
      expect(result.bias_flags).toHaveLength(0);
      expect(result.policy_violations).toHaveLength(0);
      expect(result.risk_score).toBe(0);
      expect(result.toxicity_score).toBe(0);
    });
  });

  describe('Return Shape', () => {
    it('should return all required fields with correct types', () => {
      const result = evaluateResponsibilityLane(
        'Test response content.',
        'EU_AI_ACT_STANDARD',
      );

      expect(result.lane).toBe('responsibility');
      expect(Array.isArray(result.pii_detected)).toBe(true);
      expect(typeof result.pii_score).toBe('number');
      expect(typeof result.redacted_response).toBe('string');
      expect(typeof result.toxicity_score).toBe('number');
      expect(Array.isArray(result.bias_flags)).toBe(true);
      expect(Array.isArray(result.policy_violations)).toBe(true);
      expect(typeof result.risk_score).toBe('number');
      expect(Array.isArray(result.triggering_spans)).toBe(true);
      expect(typeof result.explanation).toBe('string');

      // Scores in [0, 1]
      expect(result.risk_score).toBeGreaterThanOrEqual(0);
      expect(result.risk_score).toBeLessThanOrEqual(1);
      expect(result.pii_score).toBeGreaterThanOrEqual(0);
      expect(result.pii_score).toBeLessThanOrEqual(1);
    });
  });
});
