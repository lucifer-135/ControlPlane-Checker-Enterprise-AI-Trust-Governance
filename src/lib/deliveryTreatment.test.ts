/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { SYNTHETIC_INTERACTIONS } from '../data/interactions';
import { DEFAULT_POLICY_PROFILES } from './policyProfiles';
import { evaluateInteraction } from './decisionEngine';
import { deliveryTreatment, needsAccuracyDisclaimer } from './deliveryTreatment';

const find = (id: string) => SYNTHETIC_INTERACTIONS.find((i) => i.id === id)!;
const supportBot = DEFAULT_POLICY_PROFILES.support_bot;

describe('deliveryTreatment', () => {
  it('withholds the demo card entirely under a pre-blocking policy', () => {
    const result = evaluateInteraction(find('int-sb-011'), {
      ...supportBot,
      pre_response_blocking: true,
    });
    expect(deliveryTreatment(result)).toEqual({
      withheld: true,
      redactedTypes: [],
      accuracyWarning: false,
      reviewQueued: true,
    });
  });

  it('reports redaction and the accuracy warning when an escalation is still delivered', () => {
    const result = evaluateInteraction(find('int-sb-011'), {
      ...supportBot,
      pre_response_blocking: false,
    });
    const treatment = deliveryTreatment(result);
    expect(treatment.withheld).toBe(false);
    expect(treatment.redactedTypes).toEqual(expect.arrayContaining(['SSN', 'ACCOUNT_NO']));
    expect(new Set(treatment.redactedTypes).size).toBe(treatment.redactedTypes.length);
    expect(treatment.accuracyWarning).toBe(true);
    expect(treatment.reviewQueued).toBe(true);
  });

  it('does not add an accuracy warning to an escalation caused only by PII', () => {
    const result = evaluateInteraction(
      {
        ...find('int-sb-001'),
        retrieved_context: 'Customer record: the customer SSN is 219-09-9999.',
        response: 'The customer SSN is 219-09-9999.',
      },
      { ...supportBot, pre_response_blocking: false },
    );
    expect(result.verdict).toBe('BLOCK_ESCALATE');
    expect(needsAccuracyDisclaimer(result)).toBe(false);
    expect(deliveryTreatment(result)).toMatchObject({
      redactedTypes: ['SSN'],
      accuracyWarning: false,
    });
  });

  it('marks soft corrections with the accuracy warning and no review', () => {
    const item = find('int-ic-006');
    const result = evaluateInteraction(item, DEFAULT_POLICY_PROFILES[item.use_case]);
    expect(result.verdict).toBe('SOFT_CORRECT');
    expect(deliveryTreatment(result)).toMatchObject({ accuracyWarning: true, reviewQueued: false });
  });
});
