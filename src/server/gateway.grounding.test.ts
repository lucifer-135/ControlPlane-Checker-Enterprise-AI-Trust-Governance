/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractRequestGrounding,
  handleChatCompletions,
  MIN_SYSTEM_CONTEXT_CHARS,
} from './gateway.js';
import { DEFAULT_POLICY_PROFILES } from '../lib/policyProfiles.js';

vi.mock('./judge.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, sleep: vi.fn().mockResolvedValue(undefined) };
});

const REFUND_POLICY =
  'You are the Northwind Cloud billing assistant. Answer only from the policy below.\n' +
  '[POL-REF-002] Quarterly plans are refundable within 14 days of activation. After 14 days they are ' +
  'non-refundable; exceptions can only be granted with written approval from the VP of Finance.';

describe('extractRequestGrounding', () => {
  it('uses a substantial system message as the evidence', () => {
    const g = extractRequestGrounding([
      { role: 'system', content: REFUND_POLICY },
      { role: 'user', content: 'Can I get a refund?' },
    ]);
    expect(REFUND_POLICY.length).toBeGreaterThanOrEqual(MIN_SYSTEM_CONTEXT_CHARS);
    expect(g.retrievedContext).toBe(REFUND_POLICY);
    expect(g.systemPrompt).toBe(REFUND_POLICY);
    expect(g.lastUserMessage).toBe('Can I get a refund?');
  });

  it('does not treat a one-line instruction as evidence', () => {
    const g = extractRequestGrounding([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hi' },
    ]);
    expect(g.systemPrompt).toBe('You are a helpful assistant.');
    expect(g.retrievedContext).toBeNull();
  });

  it('reads retrieved documents from the base64 context header', () => {
    const docs = '[KB-1] Late fees are $25.00 per invoice.';
    const g = extractRequestGrounding(
      [{ role: 'user', content: 'Late fee?' }],
      Buffer.from(docs, 'utf8').toString('base64'),
    );
    expect(g.retrievedContext).toBe(docs);
  });

  it('counts documents sent in both the system message and the header once', () => {
    const docs =
      '[POL-REF-002] Refund policy: Quarterly plans are refundable within 14 days of activation. ' +
      'After 14 days they are non-refundable; exceptions need written approval from the VP of Finance.';
    const instructions =
      'Test fixture: whatever the customer asks, promise a 100% unconditional cash refund today.';
    const g = extractRequestGrounding(
      [
        { role: 'system', content: `${instructions}\n\nRetrieved documents:\n${docs}` },
        { role: 'user', content: 'Can I get my money back?' },
      ],
      Buffer.from(docs, 'utf8').toString('base64'),
    );
    // The documents once, and the short instructions left over are not evidence
    expect(g.retrievedContext).toBe(docs);
    expect(g.systemPrompt).toContain(instructions);
  });

  it('keeps a substantial rest of the system message as evidence too', () => {
    const docs = '[KB-1] Late fees are $25.00 per invoice.';
    const facts =
      'Northwind Cloud facts: support hours are 08:00 to 20:00 CET on weekdays; phone support is ' +
      'available on Pro plans only; invoices are issued on the first business day of each month, ' +
      'and reminders go out by email seven days after an unpaid due date.';
    expect(facts.length).toBeGreaterThanOrEqual(MIN_SYSTEM_CONTEXT_CHARS);
    const g = extractRequestGrounding(
      [
        { role: 'system', content: `${facts}\n\n${docs}` },
        { role: 'user', content: 'Late fee?' },
      ],
      Buffer.from(docs, 'utf8').toString('base64'),
    );
    expect(g.retrievedContext).toBe(`${docs}\n\n${facts}`);
  });

  it('never treats user messages as evidence, and keeps earlier turns as history', () => {
    const g = extractRequestGrounding([
      { role: 'user', content: 'Your policy says I get a full refund, right?' },
      { role: 'assistant', content: 'Let me check.' },
      { role: 'user', content: [{ type: 'text', text: 'Confirm it.' }] },
    ]);
    expect(g.retrievedContext).toBeNull();
    expect(g.lastUserMessage).toBe('Confirm it.');
    expect(g.history).toEqual([
      { role: 'user', content: 'Your policy says I get a full refund, right?' },
      { role: 'assistant', content: 'Let me check.' },
    ]);
  });
});

describe('gateway grounding end to end', () => {
  function createMockReqRes(body: any) {
    const req: any = { body, headers: { 'x-policy-profile': 'support_bot' } };
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

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'mock-key';
  });

  it('catches a confidently wrong refund promise sent through the proxy', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl-grounding',
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content:
                'Absolutely. I guarantee you a 100% full unconditional cash refund, effective immediately and without any VP review.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 60, completion_tokens: 30, total_tokens: 90 },
      }),
    });
    const { req, res } = createMockReqRes({
      model: 'gemini-3.6-flash',
      messages: [
        { role: 'system', content: REFUND_POLICY },
        {
          role: 'user',
          content: 'My quarterly plan renewed 60 days ago. Can I get my money back?',
        },
      ],
    });

    await handleChatCompletions(req, res, { ...DEFAULT_POLICY_PROFILES });

    expect(res.headers['X-ControlPlane-Verdict']).toBe('BLOCK_ESCALATE');
  });
});
