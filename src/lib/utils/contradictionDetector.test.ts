/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { detectContradictions } from './contradictionDetector';

describe('detectContradictions on long contexts', () => {
  it('does not flag a number the context states, even among many similar numbers', () => {
    const context = Array.from(
      { length: 20 },
      (_, n) => `Section ${n + 1}.1: rule text for section ${n + 1}.`,
    ).join(' ');
    const result = detectContradictions('Per Section 1.1, the rule applies.', context);
    expect(result.contradictions.filter((c) => c.reason.includes('Numeric'))).toHaveLength(0);
  });

  it('still flags a number that conflicts with the context, once per response number', () => {
    const context =
      'Refunds are available within 30 days of renewal. Exports are retained for 90 days. Support replies within 2 days.';
    const result = detectContradictions('Refunds are available within 365 days.', context);
    const numeric = result.contradictions.filter((c) => c.reason.includes('Numeric'));
    expect(numeric).toHaveLength(1);
    expect(numeric[0].responseTerm).toContain('365');
  });

  it('does not let a negation cross a sentence or chunk boundary', () => {
    const context =
      '[RB-1] Rollback\nDo not revoke the credential until the overlap passed without errors.\n\n[PM-2291] Postmortem describing the incident.';
    const result = detectContradictions('The postmortem PM-2291 explains the overlap.', context);
    expect(result.contradictions.some((c) => c.responseTerm.includes('postmortem'))).toBe(false);
  });

  it('still detects a negation flip within a sentence', () => {
    const context = 'Manual disbursements are not permitted for support agents.';
    const result = detectContradictions(
      'Manual disbursements are permitted for this account.',
      context,
    );
    expect(result.contradictions.some((c) => c.responseTerm === 'permitted')).toBe(true);
  });

  it('ignores terms the context both affirms and negates', () => {
    const context =
      'Approval is required for payouts. Approval is not required for credits applied to the account.';
    const result = detectContradictions('Approval is required before the payout.', context);
    expect(result.contradictions.some((c) => c.responseTerm.includes('approval'))).toBe(false);
  });
});

describe('detectContradictions absolute denials', () => {
  const benefitContext =
    'Short-term disability policy pays 66.6% of verified weekly salary up to $1,500/week after a 7-day elimination period upon physician certification.';

  it('flags an absolute denial of a benefit the context grants', () => {
    const result = detectContradictions(
      'Our corporate policy guarantees that wrist fractures never qualify for compensation under any US state law.',
      benefitContext,
    );
    expect(result.hasContradiction).toBe(true);
    expect(result.contradictions.some((c) => c.reason.includes('absolute denial'))).toBe(true);
  });

  it('does not flag an answer that restates the entitlement', () => {
    const result = detectContradictions(
      'The policy pays 66.6% of your verified weekly salary, up to $1,500 per week, after a 7-day elimination period once a physician certifies the claim.',
      benefitContext,
    );
    expect(result.contradictions.some((c) => c.reason.includes('absolute denial'))).toBe(false);
  });

  it('does not flag a denial the context itself supports', () => {
    const result = detectContradictions(
      'Cosmetic procedures are never covered by this plan.',
      'The plan covers hospital stays and surgery. Cosmetic procedures are excluded from coverage.',
    );
    expect(result.contradictions.some((c) => c.reason.includes('absolute denial'))).toBe(false);
  });
});
