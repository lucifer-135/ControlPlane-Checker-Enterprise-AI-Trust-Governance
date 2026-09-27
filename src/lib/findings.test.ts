/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { SYNTHETIC_INTERACTIONS } from '../data/interactions';
import { DEFAULT_POLICY_PROFILES } from './policyProfiles';
import { evaluateDataset, evaluateInteraction } from './decisionEngine';
import { describeTriggeringFindings, displayClaimSpans } from './findings';
import { averageOverheadMs, computeGovernanceReport, useCaseStreamStats } from './metrics';
import { evaluatePerformanceLane } from './lanes/performanceLane';
import type { EvaluationResult } from '../types';

const find = (id: string) => SYNTHETIC_INTERACTIONS.find((i) => i.id === id)!;
const evaluate = (id: string) => {
  const item = find(id);
  return evaluateInteraction(item, DEFAULT_POLICY_PROFILES[item.use_case]);
};

describe('describeTriggeringFindings', () => {
  it('lists the lanes that fired without nesting them', () => {
    const summary = describeTriggeringFindings(evaluate('int-sb-011'));
    expect(summary).toBe('Performance (Ungrounded) + Responsibility (PII Exposure)');
  });

  it('names a runaway loop as a cost finding', () => {
    expect(describeTriggeringFindings(evaluate('int-ic-005'))).toContain('Cost (Runaway Loop)');
  });

  it('names bias rather than a generic performance label', () => {
    expect(describeTriggeringFindings(evaluate('int-ds-007'))).toContain('Xenophobia');
  });
});

describe('displayClaimSpans', () => {
  it('does not split identifiers or repeat what a PII chip already shows', () => {
    const texts = displayClaimSpans(evaluate('int-sb-011')).map((s) => s.text);
    for (const fragment of ['219', '45', '8821', '021000021', '994820194']) {
      expect(texts).not.toContain(fragment);
    }
    expect(texts.some((t) => t.includes('(response:'))).toBe(false);
    expect(new Set(texts).size).toBe(texts.length);
  });
});

describe('performance lane identifiers and emails', () => {
  const context = 'Agents must never reveal the account owner email address or phone number.';

  it('checks a hyphenated identifier as one unsupported fact', () => {
    const result = evaluatePerformanceLane('', context, 'Call 415-555-0199.', 'support_bot');
    const reasons = result.triggering_spans.map((s) => s.text);
    expect(reasons).toContain('415-555-0199');
    expect(reasons).not.toContain('415');
  });

  it('treats an email that is not in the sources as unsupported', () => {
    const result = evaluatePerformanceLane(
      '',
      context,
      'Write to jane.doe@acme.com.',
      'support_bot',
    );
    expect(result.triggering_spans.some((s) => s.text === 'jane.doe@acme.com')).toBe(true);
  });

  it('accepts an email that the sources contain', () => {
    const result = evaluatePerformanceLane(
      '',
      'Send refund requests to billing@northwindcloud.com in writing.',
      'Send your request to billing@northwindcloud.com.',
      'support_bot',
    );
    expect(result.triggering_spans.some((s) => s.text.includes('@'))).toBe(false);
  });
});

describe('dashboard metrics', () => {
  const { evaluations } = evaluateDataset(SYNTHETIC_INTERACTIONS, DEFAULT_POLICY_PROFILES);

  it('counts sub-millisecond evaluations as 0 ms, not a placeholder', () => {
    const fast = {
      a: { added_overhead_latency_ms: 0 },
      b: { added_overhead_latency_ms: 2 },
    } as unknown as Record<string, EvaluationResult>;
    const items = [{ id: 'a' }, { id: 'b' }] as any;
    expect(averageOverheadMs(items, fast)).toBe(1);
    expect(averageOverheadMs([], fast)).toBe(0);
  });

  it('reports per-use-case volume and blocks from the real evaluations', () => {
    const stats = useCaseStreamStats(SYNTHETIC_INTERACTIONS, evaluations);
    expect(stats.reduce((n, s) => n + s.count, 0)).toBe(SYNTHETIC_INTERACTIONS.length);
    const blocked = SYNTHETIC_INTERACTIONS.filter(
      (i) => evaluations[i.id].verdict === 'BLOCK_ESCALATE',
    ).length;
    expect(stats.reduce((n, s) => n + s.blocked, 0)).toBe(blocked);
  });

  it('computes the governance report instead of hardcoding it', () => {
    const report = computeGovernanceReport(SYNTHETIC_INTERACTIONS, evaluations);
    expect(report.total).toBe(SYNTHETIC_INTERACTIONS.length);
    expect(report.escapes).toBe(0);
    expect(report.multiLaneTotal).toBeGreaterThan(0);
    expect(report.multiLaneDetected).toBeLessThanOrEqual(report.multiLaneTotal);
  });
});
