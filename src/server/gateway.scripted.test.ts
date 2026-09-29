/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractRequestGrounding, handleChatCompletions, workloadFromHeader } from './gateway.js';
import { getRecentGatewayEvents } from './gatewayEvents.js';
import { initDatabase } from './db/database.js';
import { globalBaselineTracker } from './rollingBaseline.js';
import { DEFAULT_POLICY_PROFILES } from '../lib/policyProfiles.js';
import {
  GATEWAY_SCENARIOS,
  SCRIPTED_MODEL_NAME,
  buildScenarioRequest,
  collectStreamText,
} from '../lib/gatewayScenarios.js';

vi.mock('./judge.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, sleep: vi.fn().mockResolvedValue(undefined) };
});

const scenario = (id: string) => GATEWAY_SCENARIOS.find((s) => s.id === id)!;

/** Request/response doubles that capture JSON bodies, headers and streamed writes. */
function mockExchange(body: any, headers: Record<string, string>, principal?: any) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const req: any = { body, headers: lower, principal };
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null,
    written: [] as string[],
    writableEnded: false,
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
    writeHead(code: number, h: Record<string, string>) {
      this.statusCode = code;
      Object.assign(this.headers, h);
    },
    write(chunk: string) {
      this.written.push(chunk);
    },
    end() {
      this.writableEnded = true;
    },
  };
  return { req, res };
}

async function send(id: string, principal?: any) {
  const { body, headers } = buildScenarioRequest(
    scenario(id),
    'gemini-flash-lite-latest',
    `s-${id}`,
  );
  const { req, res } = mockExchange(body, headers, principal);
  const { currentSeq } = getRecentGatewayEvents({ limit: 1 });
  await handleChatCompletions(req, res, { ...DEFAULT_POLICY_PROFILES });
  const { events } = getRecentGatewayEvents({ afterSeq: currentSeq, limit: 10 });
  return { res, events };
}

describe('scripted responses through the gateway', () => {
  beforeEach(() => {
    initDatabase(':memory:');
    process.env.GEMINI_API_KEY = 'mock-key';
    global.fetch = vi.fn(() => {
      throw new Error('a scripted request must not call the model');
    }) as any;
  });

  it('governs a scripted answer without calling the model', async () => {
    const { res, events } = await send('confidently-wrong');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(res.headers['X-ControlPlane-Verdict']).toBe('BLOCK_ESCALATE');
    expect(res.headers['X-ControlPlane-Response-Source']).toBe('scripted');
    expect(res.body.choices[0].finish_reason).toBe('content_filter');

    expect(events).toHaveLength(1);
    expect(events[0].interaction.id).toBe(res.headers['X-ControlPlane-Interaction-Id']);
    expect(events[0].model).toBe(SCRIPTED_MODEL_NAME);
    expect(events[0].interaction.metadata.model_name).toBe(SCRIPTED_MODEL_NAME);
  });

  it('streams a scripted answer and cuts it on an SSN', async () => {
    const { body, headers } = buildScenarioRequest(
      {
        ...scenario('pii-stream'),
        scripted: { response: 'The record is Jane Roe, SSN 219-45-8821, card on file.' },
      },
      'gemini-flash-lite-latest',
      's-stream',
    );
    const { req, res } = mockExchange(body, headers);
    const { currentSeq } = getRecentGatewayEvents({ limit: 1 });
    await handleChatCompletions(req, res, { ...DEFAULT_POLICY_PROFILES });

    const raw = res.written.join('');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(raw).toContain('content_filter');
    expect(raw).not.toContain('219-');
    expect(collectStreamText(raw)).toMatch(/^The record is Jane Roe, SSN/);
    expect(res.headers['X-ControlPlane-Response-Source']).toBe('scripted');

    const { events } = getRecentGatewayEvents({ afterSeq: currentSeq, limit: 10 });
    expect(events[0].interaction.id).toBe(res.headers['X-ControlPlane-Interaction-Id']);
    expect(events[0].isStreaming).toBe(true);
  });

  it('scores the cost lane against the tagged workload', async () => {
    const { res, events } = await send('cost-loop');
    expect(res.headers['X-ControlPlane-Verdict']).toBe('BLOCK_ESCALATE');
    expect(events[0].interaction.query_type).toBe('code_refactor');
    expect(events[0].interaction.latency_ms).toBe(7800);
    expect(events[0].evaluation.cost.is_runaway_loop).toBe(true);
  });

  it('allows a clean scripted answer and never learns a baseline from it', async () => {
    const record = vi.spyOn(globalBaselineTracker, 'recordObservation');
    const { res } = await send('clean-scripted');
    expect(res.headers['X-ControlPlane-Verdict']).toBe('ALLOW');
    expect(record).not.toHaveBeenCalled();
    record.mockRestore();
  });

  it.each(
    GATEWAY_SCENARIOS.filter((s) => s.group === 'scripted').map((s) => [
      s.id,
      s.expected.split(':')[0],
    ]),
  )('preset %s gets the verdict it promises (%s)', async (id, verdict) => {
    const { res } = await send(id);
    expect(res.headers['X-ControlPlane-Verdict']).toBe(verdict);
  });

  it('refuses scripted answers from keys below admin', async () => {
    const { res, events } = await send('confidently-wrong', {
      kind: 'api_key',
      role: 'service',
      orgId: 'org_a',
      workspaceId: 'ws1',
    });
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('scripted_response_forbidden');
    expect(events).toHaveLength(0);
  });
});

describe('live presets with typical model answers', () => {
  beforeEach(() => {
    initDatabase(':memory:');
    process.env.GEMINI_API_KEY = 'mock-key';
  });

  // What the model typically answers for each live preset
  const answers: Record<string, string> = {
    clean: 'Yes, quarterly plans are refundable within 14 days of activation [POL-REF-002].',
    'refund-promise':
      'Yes, absolutely! You will get a 100% unconditional cash refund today, with no approval needed.',
    'pii-leak':
      'Customer record, Jane Roe: Account NW-4471, Pro plan billed quarterly since 2 March 2026. ' +
      'SSN 219-45-8821. Card on file 4111 1111 1111 1111.',
  };

  it.each(Object.entries(answers))(
    'preset %s: the model gets the documents and the answer is judged against them',
    async (id, answer) => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'chatcmpl-live',
          object: 'chat.completion',
          choices: [
            { index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 150, completion_tokens: 30, total_tokens: 180 },
        }),
      }) as any;
      const { res, events } = await send(id);

      const sent = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      const firstDocument = scenario(id).context!.split('\n')[0];
      expect(sent.messages[0].role).toBe('system');
      expect(sent.messages[0].content).toContain(firstDocument);
      expect(res.headers['X-ControlPlane-Verdict']).toBe(scenario(id).expected.split(':')[0]);
      expect(events).toHaveLength(1);
    },
  );

  it('every preset gives the model its documents and uses exactly those as evidence', () => {
    for (const s of GATEWAY_SCENARIOS.filter((x) => x.context)) {
      const { body, headers } = buildScenarioRequest(s, 'gemini-flash-lite-latest', 's');
      const messages = body.messages as { role: string; content: string }[];
      expect(messages[0].content, s.id).toContain(s.context!);
      // Counted once, and the short instructions left over are not evidence
      const grounding = extractRequestGrounding(messages, headers['X-ControlPlane-Context']);
      expect(grounding.retrievedContext, s.id).toBe(s.context);
    }
  });
});

describe('gateway request options', () => {
  beforeEach(() => {
    initDatabase(':memory:');
    process.env.GEMINI_API_KEY = 'mock-key';
  });

  it('never forwards gateway options to the model provider', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl-live',
        object: 'chat.completion',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'Hello.' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    }) as any;
    const { req, res } = mockExchange(
      {
        model: 'gemini-flash-lite-latest',
        messages: [{ role: 'user', content: 'Hi' }],
        controlplane: { note: 'gateway-only option' },
      },
      { 'X-Policy-Profile': 'support_bot' },
    );
    await handleChatCompletions(req, res, { ...DEFAULT_POLICY_PROFILES });

    const forwarded = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(forwarded.controlplane).toBeUndefined();
    expect(res.headers['X-ControlPlane-Response-Source']).toBe('model');
  });

  it('returns the interaction id with an input-guard block', async () => {
    global.fetch = vi.fn() as any;
    const { res, events } = await send('injection');
    expect(res.statusCode).toBe(400);
    expect(res.headers['X-ControlPlane-Interaction-Id']).toBe(events[0].interaction.id);
    expect(res.headers['X-ControlPlane-Verdict']).toBe('BLOCK_ESCALATE');
  });

  it('lets admins pick the policy per request while other keys stay bound to theirs', async () => {
    global.fetch = vi.fn() as any;
    const policyFor = async (role: string) => {
      const { body, headers } = buildScenarioRequest(
        { ...scenario('injection'), policy: 'internal_copilot' },
        'gemini-flash-lite-latest',
        `s-bound-${role}`,
      );
      const { req, res } = mockExchange(body, headers, {
        kind: 'api_key',
        role,
        orgId: 'org_a',
        workspaceId: 'ws1',
      });
      req.resolvedPolicy = 'support_bot'; // the key's bound policy, set by the auth middleware
      await handleChatCompletions(req, res, { ...DEFAULT_POLICY_PROFILES });
      return res.headers['X-ControlPlane-Policy'];
    };
    expect(await policyFor('admin')).toBe('internal_copilot');
    expect(await policyFor('service')).toBe('support_bot');
  });

  it('rejects unknown policy names, including inherited object keys', async () => {
    global.fetch = vi.fn() as any;
    for (const name of ['no_such_policy', '__proto__', 'constructor']) {
      const { req, res } = mockExchange(
        { model: 'gemini-flash-lite-latest', messages: [{ role: 'user', content: 'Hi' }] },
        { 'X-Policy-Profile': name },
      );
      await handleChatCompletions(req, res, { ...DEFAULT_POLICY_PROFILES });
      expect(res.statusCode).toBe(400);
      expect(res.body.error.message).toContain('Unknown policy profile');
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(GATEWAY_SCENARIOS.filter((s) => s.group === 'attack').map((s) => s.id))(
    'attack preset %s is stopped by the input guard',
    async (id) => {
      global.fetch = vi.fn() as any;
      const { res } = await send(id);
      expect(res.statusCode).toBe(400);
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );

  it('accepts only simple workload names', () => {
    expect(workloadFromHeader('Refund_Policy')).toBe('refund_policy');
    expect(workloadFromHeader(['code_refactor'])).toBe('code_refactor');
    expect(workloadFromHeader('../etc/passwd')).toBe('gateway_request');
    expect(workloadFromHeader(undefined)).toBe('gateway_request');
  });
});
