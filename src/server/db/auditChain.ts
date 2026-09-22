/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Audit Chain — Cryptographically Verifiable HMAC-SHA256 Audit Trail
 *
 * Implements blockchain-style tamper-evident logging conforming to:
 * - EU AI Act Article 12 (Automatic Recording of Events / Record-Keeping)
 * - HIPAA Security Rule (Audit Controls § 164.312(b))
 *
 * Each record is cryptographically bound to its predecessor via:
 * HMAC_i = HMAC-SHA256(payload_i || HMAC_{i-1}, secretKey)
 */

import crypto from 'crypto';

export interface AuditRecordPayload {
  id: string;
  interaction_id: string;
  timestamp: string;
  request_hash: string;
  response_hash: string;
  verdict: string;
  composite_risk_score: number;
  session_risk: number;
  policy_version?: string;
  prev_log_hash: string | null;
}

export interface StoredAuditRecord extends AuditRecordPayload {
  performance_json?: string;
  cost_json?: string;
  responsibility_json?: string;
  log_hmac: string;
  created_at?: string;
}

export interface ChainVerificationResult {
  valid: boolean;
  totalVerified: number;
  brokenAtIndex?: number;
  brokenRecordId?: string;
  reason?: string;
}

/**
 * Computes a SHA-256 digest of arbitrary text (for prompts and model completions).
 */
export function hashPayload(content: string): string {
  return crypto
    .createHash('sha256')
    .update(content || '')
    .digest('hex');
}

/**
 * Computes the HMAC-SHA256 signature for an audit log entry chained to the previous record.
 */
export function computeRecordHMAC(
  record: AuditRecordPayload,
  secretKey: string = process.env.AUDIT_HMAC_SECRET || 'controlplane-default-audit-secret-key-32b',
): string {
  const canonicalString = [
    record.id,
    record.interaction_id,
    record.timestamp,
    record.request_hash,
    record.response_hash,
    record.verdict,
    record.composite_risk_score.toFixed(4),
    record.session_risk.toFixed(4),
    record.policy_version || '1.0.0',
    record.prev_log_hash ||
      'GENESIS_BLOCK_0000000000000000000000000000000000000000000000000000000000000000',
  ].join('|');

  return crypto.createHmac('sha256', secretKey).update(canonicalString).digest('hex');
}

/**
 * Validates the entire cryptographic chain of audit records.
 * Returns true if all hashes and signatures are mathematically intact.
 */
export function verifyAuditChain(
  records: StoredAuditRecord[],
  secretKey: string = process.env.AUDIT_HMAC_SECRET || 'controlplane-default-audit-secret-key-32b',
): ChainVerificationResult {
  if (records.length === 0) {
    return { valid: true, totalVerified: 0 };
  }

  let expectedPrevHash: string | null = null;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    // Check link to previous block
    if (i === 0) {
      // First block in the retrieved set
      expectedPrevHash = record.prev_log_hash;
    } else {
      if (record.prev_log_hash !== expectedPrevHash) {
        return {
          valid: false,
          totalVerified: i,
          brokenAtIndex: i,
          brokenRecordId: record.id,
          reason: `Chain broken at index ${i}: prev_log_hash '${record.prev_log_hash}' does not match prior record hmac '${expectedPrevHash}'`,
        };
      }
    }

    // Verify cryptographic signature of this block
    const recomputed = computeRecordHMAC(record, secretKey);
    if (recomputed !== record.log_hmac) {
      return {
        valid: false,
        totalVerified: i,
        brokenAtIndex: i,
        brokenRecordId: record.id,
        reason: `Cryptographic tamper detected at index ${i}: stored hmac '${record.log_hmac}' does not match recomputed '${recomputed}'`,
      };
    }

    expectedPrevHash = record.log_hmac;
  }

  return {
    valid: true,
    totalVerified: records.length,
  };
}
