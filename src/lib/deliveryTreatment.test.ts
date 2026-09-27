/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { SYNTHETIC_INTERACTIONS } from '../data/interactions';
import { DEFAULT_POLICY_PROFILES } from './policyProfiles';
import { evaluateInteraction } from './decisionEngine';
import {
  ACCURACY_DISCLAIMER,
  deliveryNote,
  deliveryTreatment,
  needsAccuracyDisclaimer,
  userVisibleResponse,
  VERIFICATION_NOTE,
  WITHHELD_RESPONSE,
} from './deliveryTreatment';

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
      verificationNote: false,
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

describe('userVisibleResponse', () => {
  it('shows the refusal for a withheld answer', () => {
    const item = find('int-sb-011');
    const view = userVisibleResponse(
      evaluateInteraction(item, { ...supportBot, pre_response_blocking: true }),
      item.response,
    );
    expect(view).toMatchObject({ withheld: true, changed: true, text: WITHHELD_RESPONSE });
    expect(view.text).not.toContain('219-45-8821');
  });

  it('shows the redacted answer with the warning when an escalation is still delivered', () => {
    const item = find('int-sb-011');
    const view = userVisibleResponse(
      evaluateInteraction(item, { ...supportBot, pre_response_blocking: false }),
      item.response,
    );
    expect(view.withheld).toBe(false);
    expect(view.body).toContain('[REDACTED_SSN]');
    expect(view.text).not.toContain('219-45-8821');
    expect(view.text.endsWith(ACCURACY_DISCLAIMER)).toBe(true);
    expect(view.disclaimer).toMatch(/^⚠️ This response has been flagged/);
  });

  it('shows a soft-corrected answer with the warning appended', () => {
    const item = find('int-ic-006');
    const view = userVisibleResponse(
      evaluateInteraction(item, DEFAULT_POLICY_PROFILES[item.use_case]),
      item.response,
    );
    expect(view.body).toBe(item.response);
    expect(view.text).toBe(item.response + ACCURACY_DISCLAIMER);
  });

  it('shows a clean answer unchanged', () => {
    const item = find('int-sb-001');
    const view = userVisibleResponse(
      evaluateInteraction(item, DEFAULT_POLICY_PROFILES[item.use_case]),
      item.response,
    );
    expect(view).toMatchObject({ text: item.response, changed: false, disclaimer: null });
  });
});

describe('BADGE verification note', () => {
  it('shows the customer a visible note on a badged answer', () => {
    const item = find('int-sb-004');
    const result = evaluateInteraction(item, DEFAULT_POLICY_PROFILES[item.use_case]);
    expect(result.verdict).toBe('BADGE');
    expect(deliveryNote(result)).toBe(VERIFICATION_NOTE);
    expect(deliveryTreatment(result)).toMatchObject({
      verificationNote: true,
      accuracyWarning: false,
    });
    const view = userVisibleResponse(result, item.response);
    expect(view.text).toBe(item.response + VERIFICATION_NOTE);
    expect(view.disclaimer).toMatch(/^ℹ️ Automated check/);
    expect(view.changed).toBe(true);
  });

  it('uses the stronger accuracy warning, not the note, for a soft correction', () => {
    const item = find('int-ic-006');
    const result = evaluateInteraction(item, DEFAULT_POLICY_PROFILES[item.use_case]);
    expect(deliveryNote(result)).toBe(ACCURACY_DISCLAIMER);
  });

  it('adds no note to a clean answer', () => {
    const item = find('int-sb-001');
    expect(
      deliveryNote(evaluateInteraction(item, DEFAULT_POLICY_PROFILES[item.use_case])),
    ).toBeNull();
  });
});
