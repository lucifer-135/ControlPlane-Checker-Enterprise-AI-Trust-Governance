/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { evaluateResponsibilityLane } from './responsibilityLane';

describe('evaluateResponsibilityLane', () => {
  describe('PII detection with Luhn validation', () => {
    it('detects a valid Visa card number (passes Luhn)', () => {
      const result = evaluateResponsibilityLane(
        'Your card number is 4111111111111111. Payment confirmed.',
      );
      const ccEntities = result.pii_detected.filter((p) => p.type === 'CREDIT_CARD');
      expect(ccEntities.length).toBeGreaterThan(0);
      expect(result.risk_score).toBeGreaterThan(0);
    });

    it('does not flag an invalid card number as CREDIT_CARD', () => {
      const result = evaluateResponsibilityLane(
        'The part number is 1234567890123456 in the specification.',
      );
      const ccEntities = result.pii_detected.filter((p) => p.type === 'CREDIT_CARD');
      // Should either not detect or downgrade to POSSIBLE_NUMERIC_ID
      expect(ccEntities.length).toBe(0);
    });

    it('detects valid SSN format', () => {
      const result = evaluateResponsibilityLane('Your social security number is 078-05-1120.');
      const ssnEntities = result.pii_detected.filter((p) => p.type === 'SSN');
      expect(ssnEntities.length).toBeGreaterThan(0);
    });

    it('rejects structurally invalid SSN (area 000)', () => {
      const result = evaluateResponsibilityLane('Reference ID: 000-12-3456 for this transaction.');
      const ssnEntities = result.pii_detected.filter((p) => p.type === 'SSN');
      expect(ssnEntities.length).toBe(0);
    });
  });

  describe('email and phone detection', () => {
    it('detects email addresses', () => {
      const result = evaluateResponsibilityLane('Contact sarah.jenkins@acmecorp.com for details.');
      const emailEntities = result.pii_detected.filter((p) => p.type === 'EMAIL');
      expect(emailEntities.length).toBeGreaterThan(0);
    });

    it('detects phone numbers', () => {
      const result = evaluateResponsibilityLane('Call us at 415-555-0199 for assistance.');
      const phoneEntities = result.pii_detected.filter((p) => p.type === 'PHONE');
      expect(phoneEntities.length).toBeGreaterThan(0);
    });
  });

  describe('generalized address detection', () => {
    it('detects US street addresses without hardcoding', () => {
      const result = evaluateResponsibilityLane(
        'Send the package to 742 Evergreen Terrace, Springfield, IL 62704.',
      );
      const addressEntities = result.pii_detected.filter((p) => p.type === 'ADDRESS');
      expect(addressEntities.length).toBeGreaterThan(0);
    });

    it('detects various address formats', () => {
      const result = evaluateResponsibilityLane(
        'The office is at 1600 Pennsylvania Avenue, Washington, DC 20500.',
      );
      const addressEntities = result.pii_detected.filter((p) => p.type === 'ADDRESS');
      expect(addressEntities.length).toBeGreaterThan(0);
    });
  });

  describe('bias and toxicity detection', () => {
    it('detects gender discrimination patterns', () => {
      const result = evaluateResponsibilityLane(
        'We should disqualify her because women with young children lack the aggressive dedication needed for VP leadership.',
      );
      expect(result.bias_flags).toContain('Gender Discrimination');
      expect(result.toxicity_score).toBeGreaterThan(0.8);
    });

    it('detects xenophobic stereotypes', () => {
      const result = evaluateResponsibilityLane(
        'Foreign-born immigrant factory workers are statistically 3x more likely to fabricate claims.',
      );
      expect(result.bias_flags).toContain('Xenophobia / National Origin');
    });

    it('detects redlining language', () => {
      const result = evaluateResponsibilityLane(
        'Zip code 90210 is a high-risk demographic neighborhood with historically higher default rates among minority populations.',
      );
      expect(result.bias_flags).toContain('Redlining & Fair Lending Violation');
    });

    it('does not flag neutral business language', () => {
      const result = evaluateResponsibilityLane(
        'Your subscription has been renewed. Thank you for your continued patronage.',
      );
      expect(result.bias_flags).toHaveLength(0);
      expect(result.toxicity_score).toBe(0);
    });
  });

  describe('policy violations by geography ruleset', () => {
    it('flags GDPR violation for EU ruleset when PII is detected', () => {
      const result = evaluateResponsibilityLane(
        'The customer email is test@example.com.',
        'EU_AI_ACT_STANDARD',
      );
      expect(result.policy_violations.some((v) => v.includes('GDPR'))).toBe(true);
    });

    it('flags HIPAA/FINRA violation for US ruleset with SSN', () => {
      const result = evaluateResponsibilityLane('Patient SSN is 078-05-1120.', 'US_HIPAA_FINRA');
      expect(result.policy_violations.some((v) => v.includes('HIPAA') || v.includes('FINRA'))).toBe(
        true,
      );
    });
  });

  describe('redaction', () => {
    it('redacts detected PII from response', () => {
      const result = evaluateResponsibilityLane('Contact john@example.com or call 415-555-0199.');
      expect(result.redacted_response).toContain('[REDACTED_EMAIL]');
      expect(result.redacted_response).toContain('[REDACTED_PHONE]');
      expect(result.redacted_response).not.toContain('john@example.com');
    });
  });
});
