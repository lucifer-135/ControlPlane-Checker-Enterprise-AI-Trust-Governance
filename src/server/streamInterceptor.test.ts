/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { interceptStream } from './streamInterceptor.js';
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
