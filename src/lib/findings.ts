/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EvaluationResult, SpanHighlight } from '../types';

/**
 * Performance-lane spans worth showing as chips: one per distinct text, leaving out
 * any that only repeat part of a PII finding (the PII chip already covers it).
 */
export function displayClaimSpans(evaluation: EvaluationResult): SpanHighlight[] {
  const piiTexts = evaluation.responsibility.triggering_spans
    .filter((s) => s.type === 'pii')
    .map((s) => s.text);
  const seen = new Set<string>();
  return evaluation.performance.triggering_spans.filter((s) => {
    if (seen.has(s.text)) return false;
    seen.add(s.text);
    return !piiTexts.some((pii) => pii.includes(s.text));
  });
}
import { piiTypeLabel } from './deliveryTreatment';

/**
 * One-line summary of the lanes that fired for an evaluation, e.g.
 * "Performance (Confidently Wrong) + Responsibility (PII Exposure)".
 */
export function describeTriggeringFindings(evaluation: EvaluationResult): string {
  if (evaluation.overlapping_lanes.length > 0) {
    return evaluation.overlapping_lanes.join(' + ');
  }
  const { performance, cost, responsibility } = evaluation;
  if (responsibility.bias_flags.length > 0)
    return `Responsibility (${responsibility.bias_flags[0]})`;
  if (responsibility.pii_detected.length > 0) {
    return `Responsibility (PII: ${piiTypeLabel(responsibility.pii_detected[0].type)})`;
  }
  if (cost.is_runaway_loop) return 'Cost (Runaway Loop)';
  if (cost.is_outlier) return 'Cost (Token/Latency Outlier)';
  if (performance.is_confidently_wrong) return 'Performance (Confidently Wrong)';
  if (performance.triggering_spans.length > 0) return 'Performance (Unsupported Claim)';
  return 'No lane above threshold';
}
