/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  computeRecordHMAC,
  hashPayload,
  verifyAuditChain,
  type StoredAuditRecord,
} from './auditChain.js';

describe('AuditChain (HMAC-SHA256 Cryptographic Chain)', () => {
  const secretKey = 'test-secret-key-for-audit-verification';

  it('computes consistent hashes for identical payloads', () => {
    const hash1 = hashPayload('Hello World');
    const hash2 = hashPayload('Hello World');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex length
  });

  it('verifies a valid chain of audit records', () => {
    const records: StoredAuditRecord[] = [];

    // Block 0 (Genesis)
    const rec0Payload = {
      id: 'audit-0',
      interaction_id: 'int-0',
      timestamp: '2026-09-22T10:00:00Z',
      request_hash: hashPayload('Prompt 0'),
      response_hash: hashPayload('Response 0'),
      verdict: 'ALLOW',
      composite_risk_score: 0.1,
      session_risk: 0.1,
      policy_version: '1.0.0',
      prev_log_hash: null,
    };
    const hmac0 = computeRecordHMAC(rec0Payload, secretKey);
    records.push({ ...rec0Payload, log_hmac: hmac0 });

    // Block 1 (Chained to Block 0)
    const rec1Payload = {
      id: 'audit-1',
      interaction_id: 'int-1',
      timestamp: '2026-09-22T10:01:00Z',
      request_hash: hashPayload('Prompt 1'),
      response_hash: hashPayload('Response 1'),
      verdict: 'BADGE',
      composite_risk_score: 0.35,
      session_risk: 0.35,
      policy_version: '1.0.0',
      prev_log_hash: hmac0,
    };
    const hmac1 = computeRecordHMAC(rec1Payload, secretKey);
    records.push({ ...rec1Payload, log_hmac: hmac1 });

    // Block 2 (Chained to Block 1)
    const rec2Payload = {
      id: 'audit-2',
      interaction_id: 'int-2',
      timestamp: '2026-09-22T10:02:00Z',
      request_hash: hashPayload('Prompt 2'),
      response_hash: hashPayload('Response 2'),
      verdict: 'BLOCK_ESCALATE',
      composite_risk_score: 0.85,
      session_risk: 0.85,
      policy_version: '1.0.0',
      prev_log_hash: hmac1,
    };
    const hmac2 = computeRecordHMAC(rec2Payload, secretKey);
    records.push({ ...rec2Payload, log_hmac: hmac2 });

    const verification = verifyAuditChain(records, secretKey);
    expect(verification.valid).toBe(true);
    expect(verification.totalVerified).toBe(3);
  });

  it('detects tampering when an attacker modifies a past record content', () => {
    const records: StoredAuditRecord[] = [];

    const rec0 = {
      id: 'audit-0',
      interaction_id: 'int-0',
      timestamp: '2026-09-22T10:00:00Z',
      request_hash: hashPayload('Clean prompt'),
      response_hash: hashPayload('Clean response'),
      verdict: 'BLOCK_ESCALATE', // Maliciously changed after signing
      composite_risk_score: 0.85,
      session_risk: 0.85,
      prev_log_hash: null,
    };
    // Sign with original verdict 'ALLOW'
    const hmac0 = computeRecordHMAC({ ...rec0, verdict: 'ALLOW' }, secretKey);
    records.push({ ...rec0, log_hmac: hmac0 });

    const verification = verifyAuditChain(records, secretKey);
    expect(verification.valid).toBe(false);
    expect(verification.brokenAtIndex).toBe(0);
    expect(verification.reason).toContain('Cryptographic tamper detected');
  });

  it('detects tampering when a block is deleted or reordered (broken chain link)', () => {
    const records: StoredAuditRecord[] = [];

    const rec0Payload = {
      id: 'audit-0',
      interaction_id: 'int-0',
      timestamp: '2026-09-22T10:00:00Z',
      request_hash: hashPayload('P0'),
      response_hash: hashPayload('R0'),
      verdict: 'ALLOW',
      composite_risk_score: 0.1,
      session_risk: 0.1,
      prev_log_hash: null,
    };
    const hmac0 = computeRecordHMAC(rec0Payload, secretKey);
    records.push({ ...rec0Payload, log_hmac: hmac0 });

    // Block 1 points to a fake/wrong previous hash
    const rec1Payload = {
      id: 'audit-1',
      interaction_id: 'int-1',
      timestamp: '2026-09-22T10:01:00Z',
      request_hash: hashPayload('P1'),
      response_hash: hashPayload('R1'),
      verdict: 'ALLOW',
      composite_risk_score: 0.1,
      session_risk: 0.1,
      prev_log_hash: 'wrong_prev_hash_1234567890abcdef',
    };
    const hmac1 = computeRecordHMAC(rec1Payload, secretKey);
    records.push({ ...rec1Payload, log_hmac: hmac1 });

    const verification = verifyAuditChain(records, secretKey);
    expect(verification.valid).toBe(false);
    expect(verification.brokenAtIndex).toBe(1);
    expect(verification.reason).toContain('Chain broken at index 1');
  });
});
