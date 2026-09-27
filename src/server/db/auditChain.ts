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
 *
 * Both ends of the chain are pinned, so records cannot silently disappear:
 * - the first record must be the genesis record (no predecessor), and
 * - a signed chain head stores the record count and the latest HMAC.
 *
 * Chain version 2 records also sign a hash of the lane evidence (performance,
 * cost and responsibility JSON) and use an unambiguous JSON canonical form.
 * Version 1 records (written before) keep verifying with their original form.
 */

import crypto from 'crypto';

export const CURRENT_CHAIN_VERSION = 2;

/** Fallback used only outside production; published in the repository, so not a secret. */
const DEV_FALLBACK_SECRET = 'controlplane-default-audit-secret-key-32b';
const MIN_SECRET_LENGTH = 16;
let warnedAboutFallback = false;

/**
 * The key audit records are signed with. Production refuses to run without a real
 * secret: with the published fallback, anyone could re-sign an edited chain.
 */
export function getAuditSecret(): string {
  const configured = process.env.AUDIT_HMAC_SECRET;
  if (configured && configured.length >= MIN_SECRET_LENGTH) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `AUDIT_HMAC_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters in production`,
    );
  }
  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      '[AuditChain] AUDIT_HMAC_SECRET is not set: signing with the public development key. ' +
        'Records are NOT tamper-proof until a secret is configured (see .env.example).',
    );
  }
  return DEV_FALLBACK_SECRET;
}

/** True when a real signing secret is configured. */
export function isAuditSecretConfigured(): boolean {
  const configured = process.env.AUDIT_HMAC_SECRET;
  return !!configured && configured.length >= MIN_SECRET_LENGTH;
}

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
  /** Tenant binding. Null on records written before tenant scoping existed. */
  org_id?: string | null;
  workspace_id?: string | null;
  /** SHA-256 of the lane evidence (chain version 2+). */
  evidence_hash?: string | null;
  /** Canonical form version; null/1 for records written before version 2. */
  chain_version?: number | null;
}

export interface StoredAuditRecord extends AuditRecordPayload {
  performance_json?: string;
  cost_json?: string;
  responsibility_json?: string;
  log_hmac: string;
  created_at?: string;
}

/** Signed pointer to the end of the chain. */
export interface AuditChainHead {
  record_count: number;
  last_hmac: string | null;
  head_hmac: string;
}

export interface ChainVerificationResult {
  valid: boolean;
  totalVerified: number;
  brokenAtIndex?: number;
  brokenRecordId?: string;
  reason?: string;
}

const GENESIS_PREV =
  'GENESIS_BLOCK_0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Computes a SHA-256 digest of arbitrary text (for prompts and model completions).
 */
export function hashPayload(content: string): string {
  return crypto
    .createHash('sha256')
    .update(content || '')
    .digest('hex');
}

/** SHA-256 over the three lanes' stored evidence. */
export function computeEvidenceHash(
  performanceJson: string | null | undefined,
  costJson: string | null | undefined,
  responsibilityJson: string | null | undefined,
): string {
  return hashPayload(
    JSON.stringify([performanceJson ?? '', costJson ?? '', responsibilityJson ?? '']),
  );
}

function canonicalV1(record: AuditRecordPayload): string {
  return [
    record.id,
    record.interaction_id,
    record.timestamp,
    record.request_hash,
    record.response_hash,
    record.verdict,
    record.composite_risk_score.toFixed(4),
    record.session_risk.toFixed(4),
    record.policy_version || '1.0.0',
    record.prev_log_hash || GENESIS_PREV,
    // Tenant fields are only part of the canonical form when present, so records
    // written before tenant scoping still verify unchanged.
    ...(record.org_id ? [record.org_id, record.workspace_id || ''] : []),
  ].join('|');
}

/** JSON array: field boundaries cannot be shifted by a value containing a separator. */
function canonicalV2(record: AuditRecordPayload): string {
  return JSON.stringify([
    CURRENT_CHAIN_VERSION,
    record.id,
    record.interaction_id,
    record.timestamp,
    record.request_hash,
    record.response_hash,
    record.verdict,
    record.composite_risk_score.toFixed(4),
    record.session_risk.toFixed(4),
    record.policy_version || '1.0.0',
    record.prev_log_hash || GENESIS_PREV,
    record.org_id ?? null,
    record.workspace_id ?? null,
    record.evidence_hash ?? null,
  ]);
}

/**
 * Computes the HMAC-SHA256 signature for an audit log entry chained to the previous record.
 */
export function computeRecordHMAC(
  record: AuditRecordPayload,
  secretKey: string = getAuditSecret(),
): string {
  const canonical = (record.chain_version ?? 1) >= 2 ? canonicalV2(record) : canonicalV1(record);
  return crypto.createHmac('sha256', secretKey).update(canonical).digest('hex');
}

/** Signature over the chain head, so its count and pointer cannot be rewritten without the key. */
export function computeHeadHMAC(
  recordCount: number,
  lastHmac: string | null,
  secretKey: string = getAuditSecret(),
): string {
  return crypto
    .createHmac('sha256', secretKey)
    .update(JSON.stringify(['audit-chain-head', recordCount, lastHmac]))
    .digest('hex');
}

/**
 * Validates the entire cryptographic chain of audit records.
 * Returns true if all hashes and signatures are mathematically intact.
 *
 * Pass the stored chain head to also detect records removed from the end of the
 * chain (or the whole chain). Without it, only edits and removals before the last
 * record can be detected.
 */
export function verifyAuditChain(
  records: StoredAuditRecord[],
  secretKey: string = getAuditSecret(),
  head?: AuditChainHead | null,
): ChainVerificationResult {
  const fail = (index: number, reason: string, recordId?: string): ChainVerificationResult => ({
    valid: false,
    totalVerified: index,
    brokenAtIndex: index,
    brokenRecordId: recordId,
    reason,
  });

  if (head) {
    if (computeHeadHMAC(head.record_count, head.last_hmac, secretKey) !== head.head_hmac) {
      return fail(0, 'Chain head signature is invalid: the head record itself was altered');
    }
  } else if (head === null && records.length > 0) {
    return fail(
      0,
      'Chain head is missing: records exist but the signed end-of-chain pointer was removed',
    );
  }

  let expectedPrevHash: string | null = null;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    if (i === 0) {
      // The chain must start at genesis; anything else means earlier records were removed
      if (record.prev_log_hash !== null) {
        return fail(
          0,
          `Chain does not start at genesis: the first record '${record.id}' points to a predecessor that is missing, so earlier records were removed`,
          record.id,
        );
      }
    } else if (record.prev_log_hash !== expectedPrevHash) {
      return fail(
        i,
        `Chain broken at index ${i}: prev_log_hash '${record.prev_log_hash}' does not match prior record hmac '${expectedPrevHash}'`,
        record.id,
      );
    }

    // Version 2 records sign their lane evidence
    if ((record.chain_version ?? 1) >= 2) {
      const evidence = computeEvidenceHash(
        record.performance_json,
        record.cost_json,
        record.responsibility_json,
      );
      if (evidence !== record.evidence_hash) {
        return fail(
          i,
          `Evidence tampered at index ${i}: the stored lane findings no longer match their signed hash`,
          record.id,
        );
      }
    }

    // Verify cryptographic signature of this block
    const recomputed = computeRecordHMAC(record, secretKey);
    if (recomputed !== record.log_hmac) {
      return fail(
        i,
        `Cryptographic tamper detected at index ${i}: stored hmac '${record.log_hmac}' does not match recomputed '${recomputed}'`,
        record.id,
      );
    }

    expectedPrevHash = record.log_hmac;
  }

  if (head) {
    const lastHmac = records.length > 0 ? records[records.length - 1].log_hmac : null;
    if (head.record_count !== records.length || head.last_hmac !== lastHmac) {
      return fail(
        records.length,
        `Chain truncated: the signed head records ${head.record_count} entries ending in '${head.last_hmac}', ` +
          `but ${records.length} remain ending in '${lastHmac}'`,
      );
    }
  }

  return {
    valid: true,
    totalVerified: records.length,
  };
}
