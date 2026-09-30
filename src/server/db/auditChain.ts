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

/** What broke the chain, so it can be explained without reading the technical reason. */
export type ChainBreakKind =
  /** The record was changed after it was signed. */
  | 'signature'
  /** The record's lane findings were changed after they were signed. */
  | 'evidence'
  /** A record before this one was removed or the records were reordered. */
  | 'link'
  /** The oldest records were removed. */
  | 'genesis'
  /** Records were removed from the end of the chain. */
  | 'truncated'
  /** The signed end-of-chain pointer was altered. */
  | 'head_invalid'
  /** The signed end-of-chain pointer was removed. */
  | 'head_missing';

export interface ChainVerificationResult {
  valid: boolean;
  totalVerified: number;
  brokenAtIndex?: number;
  brokenRecordId?: string;
  reason?: string;
  kind?: ChainBreakKind;
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

/**
 * Signature over a chain head, so its count and pointer cannot be rewritten without
 * the key. The tag keeps each chain's head signature distinct.
 */
export function computeChainHeadHMAC(
  tag: string,
  recordCount: number,
  lastHmac: string | null,
  secretKey: string = getAuditSecret(),
): string {
  return crypto
    .createHmac('sha256', secretKey)
    .update(JSON.stringify([tag, recordCount, lastHmac]))
    .digest('hex');
}

/** Signature over the audit chain head. */
export function computeHeadHMAC(
  recordCount: number,
  lastHmac: string | null,
  secretKey: string = getAuditSecret(),
): string {
  return computeChainHeadHMAC('audit-chain-head', recordCount, lastHmac, secretKey);
}

/** How to read and re-sign one kind of chained record (audit records, review decisions). */
export interface ChainSchema<T> {
  id: (record: T) => string;
  /** The signature of the previous record this one links to (null for the first). */
  prev: (record: T) => string | null;
  hmac: (record: T) => string;
  /** Recomputes the record's signature from its stored content. */
  sign: (record: T, secretKey: string) => string;
  /** Tag of this chain's head signature. */
  headTag: string;
  /** A check run before the signature; returns why the record fails, or null. */
  precheck?: (record: T, index: number) => { kind: ChainBreakKind; reason: string } | null;
}

const AUDIT_CHAIN: ChainSchema<StoredAuditRecord> = {
  id: (r) => r.id,
  prev: (r) => r.prev_log_hash,
  hmac: (r) => r.log_hmac,
  sign: (r, secretKey) => computeRecordHMAC(r, secretKey),
  headTag: 'audit-chain-head',
  // Version 2 records sign their lane evidence
  precheck: (r, i) =>
    (r.chain_version ?? 1) >= 2 &&
    computeEvidenceHash(r.performance_json, r.cost_json, r.responsibility_json) !== r.evidence_hash
      ? {
          kind: 'evidence',
          reason: `Evidence tampered at index ${i}: the stored lane findings no longer match their signed hash`,
        }
      : null,
};

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
  return verifyChain(records, AUDIT_CHAIN, secretKey, head);
}

/** Verifies any signed, linked chain (see verifyAuditChain). */
export function verifyChain<T>(
  records: T[],
  schema: ChainSchema<T>,
  secretKey: string = getAuditSecret(),
  head?: AuditChainHead | null,
): ChainVerificationResult {
  const fail = (
    index: number,
    kind: ChainBreakKind,
    reason: string,
    recordId?: string,
  ): ChainVerificationResult => ({
    valid: false,
    totalVerified: index,
    brokenAtIndex: index,
    brokenRecordId: recordId,
    reason,
    kind,
  });

  if (head) {
    if (
      computeChainHeadHMAC(schema.headTag, head.record_count, head.last_hmac, secretKey) !==
      head.head_hmac
    ) {
      return fail(
        0,
        'head_invalid',
        'Chain head signature is invalid: the head record itself was altered',
      );
    }
  } else if (head === null && records.length > 0) {
    return fail(
      0,
      'head_missing',
      'Chain head is missing: records exist but the signed end-of-chain pointer was removed',
    );
  }

  let expectedPrevHash: string | null = null;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const id = schema.id(record);
    const prev = schema.prev(record);

    if (i === 0) {
      // The chain must start at genesis; anything else means earlier records were removed
      if (prev !== null) {
        return fail(
          0,
          'genesis',
          `Chain does not start at genesis: the first record '${id}' points to a predecessor that is missing, so earlier records were removed`,
          id,
        );
      }
    } else if (prev !== expectedPrevHash) {
      return fail(
        i,
        'link',
        `Chain broken at index ${i}: its link '${prev}' does not match the prior record's signature '${expectedPrevHash}'`,
        id,
      );
    }

    const precheckFailure = schema.precheck?.(record, i);
    if (precheckFailure) return fail(i, precheckFailure.kind, precheckFailure.reason, id);

    // Verify cryptographic signature of this block
    const stored = schema.hmac(record);
    const recomputed = schema.sign(record, secretKey);
    if (recomputed !== stored) {
      return fail(
        i,
        'signature',
        `Cryptographic tamper detected at index ${i}: stored hmac '${stored}' does not match recomputed '${recomputed}'`,
        id,
      );
    }

    expectedPrevHash = stored;
  }

  if (head) {
    const lastHmac = records.length > 0 ? schema.hmac(records[records.length - 1]) : null;
    if (head.record_count !== records.length || head.last_hmac !== lastHmac) {
      return fail(
        records.length,
        'truncated',
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

/** One chain record as shown to people: its place in the chain and how it verified. */
export interface ChainBlockSummary {
  /** Position in the chain, from 0 (the genesis record). */
  index: number;
  id: string;
  /** Null for another tenant's record: only its place in the chain is shown. */
  interaction_id: string | null;
  verdict: string | null;
  timestamp: string;
  /** Start of the record's signature, and of the signature it links back to. */
  hmac: string;
  prev: string | null;
  state: ChainBlockState;
}

/**
 * verified: checked and intact. broken: where verification failed. unchecked: after
 * the break, or behind a broken chain head, so it cannot be trusted.
 */
export type ChainBlockState = 'verified' | 'broken' | 'unchecked';

export const SHORT_HASH_LENGTH = 10;

/**
 * The positions worth showing for a verification result, and how each verified:
 * around the break when a record broke the chain (a few intact records before it,
 * the untrusted ones after it), otherwise the latest ones.
 */
export function chainWindow(
  total: number,
  verification: ChainVerificationResult,
  count = 12,
): { index: number; state: ChainBlockState }[] {
  const headBroken = verification.kind === 'head_invalid' || verification.kind === 'head_missing';
  const brokenAt =
    !verification.valid &&
    !headBroken &&
    verification.kind !== 'truncated' &&
    verification.brokenAtIndex !== undefined
      ? verification.brokenAtIndex
      : -1;
  const start =
    brokenAt >= 0 ? Math.max(0, Math.min(brokenAt - 3, total - count)) : Math.max(0, total - count);
  const end = Math.min(total, start + count);

  const window: { index: number; state: ChainBlockState }[] = [];
  for (let index = start; index < end; index++) {
    const state: ChainBlockState = headBroken
      ? 'unchecked'
      : brokenAt < 0 || index < brokenAt
        ? 'verified'
        : index === brokenAt
          ? 'broken'
          : 'unchecked';
    window.push({ index, state });
  }
  return window;
}

/** The audit records worth showing for a verification result (see chainWindow). */
export function summarizeChainBlocks(
  records: StoredAuditRecord[],
  verification: ChainVerificationResult,
  count = 12,
  isVisible: (record: StoredAuditRecord) => boolean = () => true,
): ChainBlockSummary[] {
  return chainWindow(records.length, verification, count).map(({ index, state }) => {
    const record = records[index];
    const visible = isVisible(record);
    return {
      index,
      id: record.id,
      interaction_id: visible ? record.interaction_id : null,
      verdict: visible ? record.verdict : null,
      timestamp: record.timestamp,
      hmac: record.log_hmac.slice(0, SHORT_HASH_LENGTH),
      prev: record.prev_log_hash ? record.prev_log_hash.slice(0, SHORT_HASH_LENGTH) : null,
      state,
    };
  });
}
