/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tamper-evident review decisions: every decision appended to the Review Decision
 * Audit Trail is signed (HMAC-SHA256, the audit chain's key) together with the
 * signature of the decision before it, and a signed head pins the end of the chain.
 * Editing, deleting or reordering any decision breaks the chain at that point.
 */

import crypto from 'crypto';
import {
  chainWindow,
  getAuditSecret,
  SHORT_HASH_LENGTH,
  verifyChain,
  type AuditChainHead,
  type ChainBlockState,
  type ChainSchema,
  type ChainVerificationResult,
} from './auditChain.js';

/** The stored fields of a review decision that its signature covers. */
export interface DecisionRecordPayload {
  id: string;
  interaction_id: string;
  reviewer: string;
  action: string;
  notes: string | null;
  edited_response: string | null;
  original_verdict: string | null;
  new_verdict: string | null;
  primary_trigger_lane: string | null;
  reviewed_at: string;
  org_id: string | null;
  workspace_id: string | null;
  /** Signature of the previous decision; null for the first one. */
  prev_hmac: string | null;
}

export interface StoredDecisionRecord extends DecisionRecordPayload {
  hmac: string;
  created_at?: string;
}

export const DECISION_CHAIN_HEAD_TAG = 'review-decision-chain-head';

/** JSON array canonical form: a value containing a separator cannot shift fields. */
export function computeDecisionHMAC(
  record: DecisionRecordPayload,
  secretKey: string = getAuditSecret(),
): string {
  const canonical = JSON.stringify([
    'review-decision-v1',
    record.id,
    record.interaction_id,
    record.reviewer,
    record.action,
    record.notes ?? null,
    record.edited_response ?? null,
    record.original_verdict ?? null,
    record.new_verdict ?? null,
    record.primary_trigger_lane ?? null,
    record.reviewed_at,
    record.org_id ?? null,
    record.workspace_id ?? null,
    record.prev_hmac ?? null,
  ]);
  return crypto.createHmac('sha256', secretKey).update(canonical).digest('hex');
}

const DECISION_CHAIN: ChainSchema<StoredDecisionRecord> = {
  id: (r) => r.id,
  prev: (r) => r.prev_hmac,
  hmac: (r) => r.hmac,
  sign: (r, secretKey) => computeDecisionHMAC(r, secretKey),
  headTag: DECISION_CHAIN_HEAD_TAG,
};

/** Verifies the review decision chain, oldest first (see verifyAuditChain). */
export function verifyDecisionChain(
  records: StoredDecisionRecord[],
  secretKey: string = getAuditSecret(),
  head?: AuditChainHead | null,
): ChainVerificationResult {
  return verifyChain(records, DECISION_CHAIN, secretKey, head);
}

/** One decision as shown in the chain view. */
export interface DecisionBlockSummary {
  /** Position in the chain, from 0 (the first decision). */
  index: number;
  id: string;
  /** Null for another tenant's decision: only its place in the chain is shown. */
  interaction_id: string | null;
  action: string | null;
  original_verdict: string | null;
  new_verdict: string | null;
  reviewer: string | null;
  reviewed_at: string;
  /** Start of the decision's signature, and of the signature it links back to. */
  hmac: string;
  prev: string | null;
  state: ChainBlockState;
}

/** The decisions worth showing for a verification result (see chainWindow). */
export function summarizeDecisionBlocks(
  records: StoredDecisionRecord[],
  verification: ChainVerificationResult,
  count = 12,
  isVisible: (record: StoredDecisionRecord) => boolean = () => true,
): DecisionBlockSummary[] {
  return chainWindow(records.length, verification, count).map(({ index, state }) => {
    const record = records[index];
    const visible = isVisible(record);
    return {
      index,
      id: record.id,
      interaction_id: visible ? record.interaction_id : null,
      action: visible ? record.action : null,
      original_verdict: visible ? record.original_verdict : null,
      new_verdict: visible ? record.new_verdict : null,
      reviewer: visible ? record.reviewer : null,
      reviewed_at: record.reviewed_at,
      hmac: (record.hmac ?? '').slice(0, SHORT_HASH_LENGTH),
      prev: record.prev_hmac ? record.prev_hmac.slice(0, SHORT_HASH_LENGTH) : null,
      state,
    };
  });
}
