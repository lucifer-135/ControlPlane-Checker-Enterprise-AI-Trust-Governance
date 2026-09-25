/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleChatCompletions } from './gateway.js';
import { DEFAULT_POLICY_PROFILES } from '../lib/policyProfiles.js';
import { evaluateInteraction } from '../lib/decisionEngine.js';

vi.mock('./judge.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, sleep: vi.fn().mockResolvedValue(undefined) };
});

const realEngine: any = await vi.importActual('../lib/decisionEngine.js');
vi.mock('../lib/decisionEngine.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, evaluateInteraction: vi.fn(actual.evaluateInteraction) };
});

const DISCLAIMER = 'flagged for potential accuracy concerns';

function mockUpstream(content: string) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      id: 'chatcmpl-disclaimer',
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 20, total_tokens: 25 },
    }),
  });
}

function createMockReqRes() {
  const req: any = {
    body: { model: 'gemini-3.6-flash', messages: [{ role: 'user', content: 'Refund?' }] },
    headers: { 'x-policy-profile': 'support_bot' },
  };
  const res: any = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    },
    set(h: Record<string, string>) {
      Object.assign(this.headers, h);
      return this;
    },
  };
  return { req, res };
}

/** Runs the real engine once, then overrides the fields a test needs. */
function overrideNextEvaluation(patch: (result: any) => void) {
  vi.mocked(evaluateInteraction).mockImplementationOnce((...args: any[]) => {
    const result = realEngine.evaluateInteraction(...args);
    patch(result);
    return result;
  });
}

describe('Gateway disclaimers for delivered escalations', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'mock-key';
  });

  it('adds the accuracy disclaimer to a confidently wrong answer a non-blocking policy delivers', async () => {
    mockUpstream('You will get a 100% unconditional cash refund within 2 hours.');
    overrideNextEvaluation((r) => {
      r.verdict = 'BLOCK_ESCALATE';
      r.performance.is_confidently_wrong = true;
    });
    const { req, res } = createMockReqRes();
    await handleChatCompletions(req, res, { ...DEFAULT_POLICY_PROFILES });

    expect(res.body.governance.verdict).toBe('BLOCK_ESCALATE');
    expect(res.body.choices[0].message.content).toContain('unconditional cash refund');
    expect(res.body.choices[0].message.content).toContain(DISCLAIMER);
  });

  it('keeps the disclaimer when a soft-corrected answer is also redacted', async () => {
    mockUpstream('Reach the owner at sarah.jenkins@acmecorp.com for a full refund.');
    overrideNextEvaluation((r) => {
      r.verdict = 'SOFT_CORRECT';
    });
    const { req, res } = createMockReqRes();
    await handleChatCompletions(req, res, { ...DEFAULT_POLICY_PROFILES });

    const content = res.body.choices[0].message.content;
    expect(content).toContain('[REDACTED_EMAIL]');
    expect(content).not.toContain('sarah.jenkins@acmecorp.com');
    expect(content).toContain(DISCLAIMER);
  });

  it('does not add an accuracy disclaimer to an answer escalated only for PII', async () => {
    mockUpstream('The customer SSN is 078-05-1120.');
    const { req, res } = createMockReqRes();
    await handleChatCompletions(req, res, { ...DEFAULT_POLICY_PROFILES });

    expect(res.body.governance.verdict).toBe('BLOCK_ESCALATE');
    expect(res.body.choices[0].message.content).toBe('The customer SSN is [REDACTED_SSN].');
  });
});
