/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { interceptStream } from './streamInterceptor.js';
import { getRecentGatewayEvents } from './gatewayEvents.js';
import { DEFAULT_POLICY_PROFILES } from '../lib/policyProfiles.js';
import type { SessionState } from '../types.js';

// Helper to create a mock Response with an SSE stream body
function createMockSseResponse(chunks: string[]): globalThis.Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

// Helper to create a mock Express response
function createMockExpressResponse() {
  const writtenData: string[] = [];
  let isEnded = false;

  return {
    writtenData,
    writeHead: () => {},
    write: (chunk: string) => {
      writtenData.push(chunk);
    },
    end: () => {
      isEnded = true;
    },
    get isEnded() {
      return isEnded;
    },
    get writableEnded() {
      return isEnded;
    },
  } as any;
}

describe('StreamInterceptor', () => {
  it('passes clean streaming chunks to client without interruption', async () => {
    const policy = DEFAULT_POLICY_PROFILES.support_bot;
    const sessionState: SessionState = { events: [], currentRisk: 0 };

    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hello, "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"how can I "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"assist you today?"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const upstream = createMockSseResponse(chunks);
    const clientRes = createMockExpressResponse();

    const audit = await interceptStream(upstream, clientRes, policy, 'Hello!', sessionState, 1);

    expect(audit.hardViolationDetected).toBe(false);
    expect(audit.fullText).toBe('Hello, how can I assist you today?');
    expect(clientRes.isEnded).toBe(true);
    expect(clientRes.writtenData.some((d: string) => d.includes('assist you today?'))).toBe(true);
  });

  it('cuts stream immediately when a hard SSN violation appears mid-stream', async () => {
    // Policy with pre-response blocking enabled
    const strictPolicy = {
      ...DEFAULT_POLICY_PROFILES.decision_support,
      pre_response_blocking: true,
    };
    const sessionState: SessionState = { events: [], currentRisk: 0 };

    const chunks = [
      'data: {"choices":[{"delta":{"content":"Your file number is confidential. "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"SSN: 219-09-9999 "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"and your account is approved."}}]}\n\n',
    ];

    const upstream = createMockSseResponse(chunks);
    const clientRes = createMockExpressResponse();

    const audit = await interceptStream(
      upstream,
      clientRes,
      strictPolicy,
      'What is my SSN?',
      sessionState,
      1,
    );

    expect(audit.hardViolationDetected).toBe(true);
    expect(audit.violationReason).toContain('Social Security Number');
    expect(clientRes.isEnded).toBe(true);
    // Verified that the stream cut event was emitted
    expect(clientRes.writtenData.some((d: string) => d.includes('content_filter'))).toBe(true);
    expect(
      clientRes.writtenData.some((d: string) => d.includes('CONTROLPLANE: Content filter')),
    ).toBe(true);
    // Downstream chunks after violation must NOT have been written
    expect(
      clientRes.writtenData.some((d: string) => d.includes('and your account is approved.')),
    ).toBe(false);
  });
});

// ── Regression tests: nothing sensitive reaches the client, even partially ──

const strictPolicy = { ...DEFAULT_POLICY_PROFILES.decision_support, pre_response_blocking: true };
const redactPolicy = DEFAULT_POLICY_PROFILES.support_bot;

const contentChunk = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`;

/** Everything the client received, as one raw string. */
const rawOutput = (clientRes: any) => clientRes.writtenData.join('');

/** Reassembles the text the client would render for one choice. */
function clientText(clientRes: any, choice = 0): string {
  let text = '';
  for (const line of rawOutput(clientRes).split('\n')) {
    const m = /^data:\s?(.*)$/.exec(line);
    if (!m || m[1] === '[DONE]') continue;
    try {
      const parsed = JSON.parse(m[1]);
      for (const c of parsed.choices ?? []) {
        if ((c.index ?? 0) === choice && typeof c.delta?.content === 'string')
          text += c.delta.content;
      }
    } catch {
      text += m[1];
    }
  }
  return text;
}

async function run(chunks: string[], policy: any = strictPolicy) {
  const clientRes = createMockExpressResponse();
  const audit = await interceptStream(
    createMockSseResponse(chunks),
    clientRes,
    policy,
    'q',
    { events: [], currentRisk: 0 },
    1,
  );
  return { audit, clientRes, raw: rawOutput(clientRes) };
}

describe('StreamInterceptor holdback protection', () => {
  it('never releases a partial SSN split across tokens', async () => {
    const { audit, raw } = await run([
      contentChunk('Your SSN is '),
      contentChunk('219-'),
      contentChunk('09-'),
      contentChunk('9999'),
      contentChunk(' on file.'),
    ]);
    expect(audit.hardViolationDetected).toBe(true);
    expect(raw).not.toContain('219');
    expect(raw).toContain('content_filter');
  });

  it('never releases partial card digits split across tokens', async () => {
    const { audit, raw } = await run([
      contentChunk('Card 4111 '),
      contentChunk('1111 1111 '),
      contentChunk('1111'),
      contentChunk(' done'),
    ]);
    expect(audit.violationReason).toContain('credit card');
    expect(raw).not.toContain('4111');
  });

  it('keeps clean text before the violation ahead of the cut marker', async () => {
    const { clientRes } = await run([
      contentChunk('Hello there. '),
      contentChunk('SSN 219-09-9999 x'),
    ]);
    expect(clientText(clientRes)).toMatch(/^Hello there\. SSN \n\n\[STREAM INTERCEPTED/);
  });

  it('reassembles long clean output exactly, including the held tail', async () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i} `);
    const { audit, clientRes } = await run(words.map(contentChunk), redactPolicy);
    expect(audit.hardViolationDetected).toBe(false);
    expect(clientText(clientRes)).toBe(words.join(''));
  });

  it('releases text before the stream ends once it is past the holdback window', async () => {
    const text = 'The refund policy allows returns within thirty days of purchase for all items.';
    const { clientRes } = await run([contentChunk(text), 'data: [DONE]\n\n'], redactPolicy);
    const beforeFinal = clientRes.writtenData[0] as string;
    expect(beforeFinal).toContain('The refund policy');
    expect(clientText(clientRes)).toBe(text);
  });
});

describe('StreamInterceptor redaction for non-blocking policies', () => {
  it('redacts an SSN inline instead of passing it through', async () => {
    const { audit, clientRes, raw } = await run(
      [contentChunk('The SSN is 219-09-9999, confirmed.')],
      redactPolicy,
    );
    expect(audit.hardViolationDetected).toBe(false);
    expect(audit.redactedTypes).toEqual(['SSN']);
    expect(raw).not.toContain('219-09-9999');
    expect(clientText(clientRes)).toBe('The SSN is [REDACTED_SSN], confirmed.');
  });

  it('redacts a card split across tokens without leaking digits', async () => {
    const { clientRes, raw } = await run(
      [contentChunk('Card: 4111 1111 '), contentChunk('1111 1111'), contentChunk(' thanks')],
      redactPolicy,
    );
    expect(raw).not.toContain('4111');
    expect(clientText(clientRes)).toBe('Card: [REDACTED_CREDIT_CARD] thanks');
  });

  it('redacts a match that ends exactly at the end of the stream', async () => {
    const { clientRes } = await run([contentChunk('SSN 219-09-9999')], redactPolicy);
    expect(clientText(clientRes)).toBe('SSN [REDACTED_SSN]');
  });
});

describe('StreamInterceptor stream parsing', () => {
  it('scans data: lines without a space after the colon', async () => {
    const { audit, raw } = await run([
      `data:${JSON.stringify({ choices: [{ delta: { content: 'SSN 219-09-9999' } }] })}\n\n`,
    ]);
    expect(audit.hardViolationDetected).toBe(true);
    expect(raw).not.toContain('219-09-9999');
  });

  it('scans a final event that has no trailing newline', async () => {
    const { audit, raw } = await run([
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'SSN 219-09-9999' } }] })}`,
    ]);
    expect(audit.hardViolationDetected).toBe(true);
    expect(raw).not.toContain('219-09-9999');
  });

  it('scans every choice when n > 1', async () => {
    const { audit, raw } = await run([
      `data: ${JSON.stringify({
        choices: [
          { index: 0, delta: { content: 'hi' } },
          { index: 1, delta: { content: 'SSN 219-09-9999' } },
        ],
      })}\n\n`,
    ]);
    expect(audit.hardViolationDetected).toBe(true);
    expect(raw).not.toContain('219-09-9999');
  });

  it('scans tool-call arguments', async () => {
    const toolChunk = (args: string) =>
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args } }] } }] })}\n\n`;
    const { audit, raw } = await run([toolChunk('{"ssn":"219-'), toolChunk('09-9999"}')]);
    expect(audit.hardViolationDetected).toBe(true);
    expect(raw).not.toContain('219');
  });

  it('finds a real card after a non-Luhn number', async () => {
    const { audit, raw } = await run([
      contentChunk('Order 1234 5678 9012 3456 then card 4111 1111 1111 1111 ok'),
    ]);
    expect(audit.violationReason).toContain('credit card');
    expect(raw).not.toContain('4111');
  });

  it('does not flag a non-Luhn 16-digit order number', async () => {
    const { audit, clientRes } = await run([contentChunk('Order 1234 5678 9012 3456 shipped.')]);
    expect(audit.hardViolationDetected).toBe(false);
    expect(clientText(clientRes)).toBe('Order 1234 5678 9012 3456 shipped.');
  });

  it('flushes held text into the finish_reason chunk in order', async () => {
    const { clientRes } = await run(
      [
        contentChunk('Short answer.'),
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
        'data: [DONE]\n\n',
      ],
      redactPolicy,
    );
    const raw = rawOutput(clientRes);
    expect(clientText(clientRes)).toBe('Short answer.');
    expect(raw.indexOf('Short answer.')).toBeLessThan(raw.indexOf('[DONE]'));
  });
});

describe('StreamInterceptor hardening', () => {
  it('cuts the stream on an unparseable event under a FAIL_CLOSED policy', async () => {
    const failClosed = { ...strictPolicy, failMode: 'FAIL_CLOSED' as const };
    const { audit, raw } = await run(['data: {not json 219-09-9999\n\n'], failClosed);
    expect(audit.hardViolationDetected).toBe(true);
    expect(audit.violationReason).toContain('FAIL_CLOSED');
    expect(raw).not.toContain('219-09-9999');
  });

  it('redacts PII in unparseable events under FAIL_OPEN policies', async () => {
    const { raw } = await run(['data: raw text 219-09-9999\n\n'], redactPolicy);
    expect(raw).toContain('[REDACTED_SSN]');
    expect(raw).not.toContain('219-09-9999');
  });

  it('stops reading upstream when the client disconnects', async () => {
    let pulls = 0;
    let cancelled = false;
    const encoder = new TextEncoder();
    const upstream = new Response(
      new ReadableStream({
        async pull(controller) {
          await new Promise((r) => setTimeout(r, 2)); // a real network stream yields between chunks
          pulls++;
          controller.enqueue(encoder.encode(contentChunk(`token${pulls} `)));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    const listeners: Record<string, () => void> = {};
    const clientRes = createMockExpressResponse();
    clientRes.on = (event: string, fn: () => void) => {
      listeners[event] = fn;
    };
    clientRes.off = () => {};
    setTimeout(() => listeners.close?.(), 20);

    await interceptStream(
      upstream,
      clientRes,
      redactPolicy,
      'q',
      { events: [], currentRisk: 0 },
      1,
    );
    expect(cancelled).toBe(true);
    const pullsAtEnd = pulls;
    await new Promise((r) => setTimeout(r, 20));
    expect(pulls).toBeLessThanOrEqual(pullsAtEnd + 1); // at most the pull already in flight
  });
});

describe('StreamInterceptor request context', () => {
  it('records the gateway tenant, session, model, and upstream usage', async () => {
    const policy = DEFAULT_POLICY_PROFILES.support_bot;
    const sessionState: SessionState = { events: [], currentRisk: 0 };
    const upstream = createMockSseResponse([
      'data: {"choices":[{"delta":{"content":"Hello there."}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}}\n\n',
      'data: [DONE]\n\n',
    ]);
    const { currentSeq } = getRecentGatewayEvents({ limit: 1 });

    await interceptStream(upstream, createMockExpressResponse(), policy, 'Hi', sessionState, 2, {
      tenantOrgId: 'org_stream',
      tenantWorkspaceId: 'ws_stream',
      sessionId: 'session-abc',
      model: 'gemini-3.6-flash',
      policyKey: 'support_bot',
    });

    const { events } = getRecentGatewayEvents({ afterSeq: currentSeq, limit: 10 });
    const event = events[events.length - 1];
    expect(event.tenantOrgId).toBe('org_stream');
    expect(event.tenantWorkspaceId).toBe('ws_stream');
    expect(event.model).toBe('gemini-3.6-flash');
    expect(event.interaction.session_id).toBe('session-abc');
    expect(event.interaction.metadata.model_name).toBe('gemini-3.6-flash');
    expect(event.interaction.token_count.total).toBe(10);
  });
});
