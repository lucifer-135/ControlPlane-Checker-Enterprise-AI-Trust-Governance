/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Delivery treatment — what the gateway actually sends the client for an
 * evaluated response. Shared by the gateway (which applies it) and the
 * dashboard (which describes it), so the two cannot drift apart.
 */

import type { DetectedEntity, EvaluationResult } from '../types';

export interface DeliveryTreatment {
  /** Replaced with a governance refusal (pre-response blocking). */
  withheld: boolean;
  /** PII types redacted from the delivered response (empty when withheld). */
  redactedTypes: DetectedEntity['type'][];
  /** Accuracy warning appended to the delivered response. */
  accuracyWarning: boolean;
  /** Sent to the human review queue. */
  reviewQueued: boolean;
}

const PII_TYPE_LABELS: Record<DetectedEntity['type'], string> = {
  SSN: 'SSN',
  CREDIT_CARD: 'card number',
  ACCOUNT_NO: 'account number',
  EMAIL: 'email',
  PHONE: 'phone number',
  NAME: 'name',
  ADDRESS: 'address',
  IP_ADDRESS: 'IP address',
  POSSIBLE_NUMERIC_ID: 'numeric ID',
};

export function piiTypeLabel(type: DetectedEntity['type']): string {
  return PII_TYPE_LABELS[type] ?? type;
}

/**
 * SOFT_CORRECT carries an accuracy disclaimer, and so does a BLOCK_ESCALATE that a
 * non-pre-blocking policy still delivers when the answer itself is ungrounded.
 */
export function needsAccuracyDisclaimer(evaluation: EvaluationResult): boolean {
  if (evaluation.verdict === 'SOFT_CORRECT') return true;
  return (
    evaluation.verdict === 'BLOCK_ESCALATE' &&
    (evaluation.performance.is_confidently_wrong ||
      evaluation.overlapping_lanes.some((l) => l.startsWith('Performance')))
  );
}

export function deliveryTreatment(evaluation: EvaluationResult): DeliveryTreatment {
  const withheld = evaluation.is_pre_response_blocked;
  return {
    withheld,
    redactedTypes: withheld
      ? []
      : [...new Set(evaluation.responsibility.pii_detected.map((p) => p.type))],
    accuracyWarning: !withheld && needsAccuracyDisclaimer(evaluation),
    reviewQueued: evaluation.is_flagged_for_review,
  };
}
