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
  /** Milder "not fully verified" note appended to a BADGE response. */
  verificationNote: boolean;
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
  COMPENSATION: 'compensation',
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

/** What a pre-blocked user receives instead of the model's answer. */
export const WITHHELD_RESPONSE =
  "I'm unable to provide this response as it has been flagged by our governance system. A human reviewer has been notified.";

/** Appended to delivered answers that need an accuracy warning. */
export const ACCURACY_DISCLAIMER =
  '\n\n---\n⚠️ *This response has been flagged for potential accuracy concerns. Please verify the information independently before acting on it.*';

/** Appended to BADGE answers: allowed, but some details were not fully verified. */
export const VERIFICATION_NOTE =
  '\n\n---\nℹ️ *Automated check: some details in this answer could not be fully verified against our records. Please confirm important figures before relying on them.*';

/** The note appended to a delivered answer, if any. */
export function deliveryNote(evaluation: EvaluationResult): string | null {
  if (needsAccuracyDisclaimer(evaluation)) return ACCURACY_DISCLAIMER;
  if (evaluation.verdict === 'BADGE') return VERIFICATION_NOTE;
  return null;
}

/** A note as plain text for display ("---" and markdown emphasis removed). */
function plainNote(note: string): string {
  return note
    .replace(/^[\s-]+/, '')
    .replace(/\*/g, '')
    .trim();
}

export interface UserVisibleResponse {
  /** The text the end user receives (the gateway sends exactly this for a text answer). */
  text: string;
  /** The answer body, without the appended disclaimer. */
  body: string;
  /** The disclaimer shown under the body, if any (plain text). */
  disclaimer: string | null;
  withheld: boolean;
  /** True when the user sees something other than the model's original answer. */
  changed: boolean;
}

/** The response as the end user receives it: withheld, redacted, and/or with a warning. */
export function userVisibleResponse(
  evaluation: EvaluationResult,
  originalResponse: string,
): UserVisibleResponse {
  const treatment = deliveryTreatment(evaluation);
  if (treatment.withheld) {
    return {
      text: WITHHELD_RESPONSE,
      body: WITHHELD_RESPONSE,
      disclaimer: null,
      withheld: true,
      changed: true,
    };
  }
  const body =
    treatment.redactedTypes.length > 0
      ? evaluation.responsibility.redacted_response
      : originalResponse;
  const note = body.length > 0 ? deliveryNote(evaluation) : null;
  return {
    text: note ? body + note : body,
    body,
    disclaimer: note ? plainNote(note) : null,
    withheld: false,
    changed: note !== null || treatment.redactedTypes.length > 0,
  };
}

export function deliveryTreatment(evaluation: EvaluationResult): DeliveryTreatment {
  const withheld = evaluation.is_pre_response_blocked;
  return {
    withheld,
    redactedTypes: withheld
      ? []
      : [...new Set(evaluation.responsibility.pii_detected.map((p) => p.type))],
    accuracyWarning: !withheld && needsAccuracyDisclaimer(evaluation),
    verificationNote: !withheld && deliveryNote(evaluation) === VERIFICATION_NOTE,
    reviewQueued: evaluation.is_flagged_for_review,
  };
}
