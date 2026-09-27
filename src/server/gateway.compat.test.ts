/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OpenAI wire-compatibility tests: drive the real Express app over HTTP the way the
 * OpenAI SDK does (POST {baseURL}/chat/completions, GET {baseURL}/models, Bearer key)
 * against a stubbed upstream, and check the gateway passes the protocol through.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createApp, type CreatedApp } from './app.js';
import { createNewApiKey, initDatabase } from './db/database.js';
import { getUpstreamBreaker, resetModelListCache, upstreamErrorBody } from './gateway.js';

vi.mock('./judge.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, sleep: vi.fn().mockResolvedValue(undefined) };
});

const realFetch = globalThis.fetch;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const completion = (choices: any[]) => ({
  id: 'chatcmpl-compat',
  object: 'chat.completion',
  created: 1,
  model: 'gpt-4o',
  system_fingerprint: 'fp_test',
  choices,
  usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
});

const toolCall = (args: string) => ({
  id: 'call_1',
  type: 'function',
  function: { name: 'lookup_customer', arguments: args },
});

describe('Gateway OpenAI wire compatibility', () => {
  let created: CreatedApp;
  let server: http.Server;
  let base: string;
  let policiesDir: string;
  let serviceKey: string;
  let strictKey: string;
  let upstream: (url: string, body: any) => Response;
  let upstreamUrls: string[];
  const savedAnthropicKey = process.env.ANTHROPIC_API_KEY;

  const post = (body: unknown, key = serviceKey) =>
    realFetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const get = (route: string, key: string | null = serviceKey) =>
    realFetch(`${base}${route}`, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
  const ask = (extra: Record<string, unknown> = {}) => ({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Look up the customer' }],
    ...extra,
  });

  beforeAll(async () => {
    initDatabase(':memory:');
    process.env.OPENAI_API_KEY = 'mock-openai-key';
    process.env.GEMINI_API_KEY = 'mock-gemini-key';
    delete process.env.ANTHROPIC_API_KEY;
    policiesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-compat-policies-'));
    serviceKey = createNewApiKey('org_c', 'ws1', '', 'support_bot', 1000, 'service').rawKey;
    strictKey = createNewApiKey('org_c', 'ws1', '', 'decision_support', 1000, 'service').rawKey;
    created = createApp({ authMode: 'required', policiesDir });
    server = http.createServer(created.app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    created.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(policiesDir, { recursive: true, force: true });
    if (savedAnthropicKey !== undefined) process.env.ANTHROPIC_API_KEY = savedAnthropicKey;
  });

  beforeEach(() => {
    upstreamUrls = [];
    upstream = () =>
      json(
        completion([
          { index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' },
        ]),
      );
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      upstreamUrls.push(String(url));
      return upstream(String(url), init?.body ? JSON.parse(init.body) : undefined);
    }) as any;
    getUpstreamBreaker().reset();
    resetModelListCache();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  // ── Fix 1: the upstream response is passed through intact ──

  describe('non-streaming responses', () => {
    it('keeps tool calls, null content and finish_reason', async () => {
      upstream = () =>
        json(
          completion([
            {
              index: 0,
              message: { role: 'assistant', content: null, tool_calls: [toolCall('{"id":"42"}')] },
              finish_reason: 'tool_calls',
            },
          ]),
        );
      const body = await (await post(ask())).json();
      const choice = body.choices[0];
      expect(choice.finish_reason).toBe('tool_calls');
      expect(choice.message.content).toBeNull();
      expect(choice.message.tool_calls).toEqual([toolCall('{"id":"42"}')]);
    });

    it('returns every choice when n > 1, each governed', async () => {
      upstream = () =>
        json(
          completion([
            {
              index: 0,
              message: { role: 'assistant', content: 'First answer.' },
              finish_reason: 'stop',
            },
            {
              index: 1,
              message: { role: 'assistant', content: 'Reach sarah.jenkins@acmecorp.com.' },
              finish_reason: 'stop',
            },
          ]),
        );
      const body = await (await post(ask({ n: 2 }))).json();
      expect(body.choices.map((c: any) => c.index)).toEqual([0, 1]);
      expect(body.choices[0].message.content).toBe('First answer.');
      expect(body.choices[1].message.content).toBe('Reach [REDACTED_EMAIL].');
    });

    it('keeps refusal, annotations, logprobs and top-level fields', async () => {
      const logprobs = { content: [{ token: 'No', logprob: -0.1, top_logprobs: [] }] };
      upstream = () =>
        json(
          completion([
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                refusal: 'I cannot help with that.',
                annotations: [],
              },
              finish_reason: 'stop',
              logprobs,
            },
          ]),
        );
      const body = await (await post(ask())).json();
      expect(body.choices[0].message.refusal).toBe('I cannot help with that.');
      expect(body.choices[0].message.annotations).toEqual([]);
      expect(body.choices[0].logprobs).toEqual(logprobs);
      expect(body.system_fingerprint).toBe('fp_test');
      expect(body.usage.total_tokens).toBe(10);
    });

    it('redacts PII inside tool-call arguments and keeps them valid JSON', async () => {
      upstream = () =>
        json(
          completion([
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  toolCall('{"email":"sarah.jenkins@acmecorp.com","ssn":"219-09-9999"}'),
                ],
              },
              finish_reason: 'tool_calls',
            },
          ]),
        );
      const resp = await post(ask());
      const body = await resp.json();
      const args = body.choices[0].message.tool_calls[0].function.arguments;
      expect(JSON.stringify(body)).not.toContain('219-09-9999');
      expect(JSON.stringify(body)).not.toContain('sarah.jenkins@acmecorp.com');
      expect(JSON.parse(args)).toEqual({ email: '[REDACTED_EMAIL]', ssn: '[REDACTED_SSN]' });
      // PII in tool arguments is part of the governance decision, not only redacted
      expect(resp.headers.get('x-controlplane-verdict')).toBe('BLOCK_ESCALATE');
    });

    it('withholds every choice under a pre-blocking policy', async () => {
      upstream = () =>
        json(
          completion([
            {
              index: 0,
              message: { role: 'assistant', content: 'SSN 219-09-9999' },
              finish_reason: 'stop',
            },
            {
              index: 1,
              message: { role: 'assistant', content: 'SSN 219-09-9999' },
              finish_reason: 'stop',
            },
          ]),
        );
      const body = await (await post(ask({ n: 2 }), strictKey)).json();
      expect(body.choices).toHaveLength(2);
      for (const c of body.choices) {
        expect(c.finish_reason).toBe('content_filter');
        expect(c.message.content).toContain('flagged by our governance system');
      }
      expect(JSON.stringify(body)).not.toContain('219-09-9999');
    });
  });

  // ── Fix 2: GET /v1/models ──

  describe('model listing', () => {
    beforeEach(() => {
      upstream = (url) => {
        if (url === 'https://api.openai.com/v1/models') {
          return json({
            object: 'list',
            data: [
              { id: 'gpt-4o', object: 'model', created: 1715367049, owned_by: 'system' },
              { id: 'o3-mini', object: 'model', created: 1737146383, owned_by: 'system' },
            ],
          });
        }
        if (url.includes('generativelanguage.googleapis.com')) {
          return json({
            object: 'list',
            data: [{ id: 'models/gemini-3.6-flash', object: 'model' }],
          });
        }
        if (url.includes('localhost:11434')) {
          // Ollama lists a model the gateway would route to OpenAI; it must be left out
          return json({ object: 'list', data: [{ id: 'qwen2.5:7b' }, { id: 'llama3.1:8b' }] });
        }
        return json({ error: { message: 'unexpected' } }, 500);
      };
    });

    it('lists models from every configured provider in OpenAI list format', async () => {
      const resp = await get('/v1/models');
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.object).toBe('list');
      const ids = body.data.map((m: any) => m.id);
      expect(ids).toEqual(
        expect.arrayContaining(['gpt-4o', 'o3-mini', 'models/gemini-3.6-flash', 'qwen2.5:7b']),
      );
      expect(ids).toContain('gemini-3.6-flash'); // configured fallback
      for (const m of body.data) {
        expect(m).toEqual({
          id: expect.any(String),
          object: 'model',
          created: expect.any(Number),
          owned_by: expect.any(String),
        });
      }
    });

    it('lists only models the gateway routes back to the same provider', async () => {
      const ids = (await (await get('/v1/models')).json()).data.map((m: any) => m.id);
      expect(ids).not.toContain('llama3.1:8b');
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('omits providers without a configured key', async () => {
      await get('/v1/models');
      expect(upstreamUrls.some((u) => u.includes('anthropic.com'))).toBe(false);
    });

    it('falls back to configured models when a provider cannot be reached', async () => {
      upstream = () => json({ error: { message: 'down' } }, 503);
      const ids = (await (await get('/v1/models')).json()).data.map((m: any) => m.id);
      expect(ids).toContain('gemini-3.6-flash');
      expect(ids).not.toContain('gpt-4o');
    });

    it('caches the list between calls', async () => {
      await get('/v1/models');
      const calls = upstreamUrls.length;
      await get('/models');
      expect(upstreamUrls.length).toBe(calls);
    });

    it('retrieves a single model and 404s an unknown one in OpenAI error format', async () => {
      const found = await get('/v1/models/gpt-4o');
      expect(found.status).toBe(200);
      expect((await found.json()).id).toBe('gpt-4o');

      const missing = await get('/v1/models/not-a-model');
      expect(missing.status).toBe(404);
      expect((await missing.json()).error).toMatchObject({
        code: 'model_not_found',
        param: 'model',
      });
    });

    it('requires an API key', async () => {
      expect((await get('/v1/models', null)).status).toBe(401);
    });
  });

  // ── Fix 3: upstream errors keep their OpenAI shape ──

  describe('upstream errors', () => {
    it('passes an OpenAI-shaped error through with type, param and code', async () => {
      const error = {
        message: 'Invalid value for temperature',
        type: 'invalid_request_error',
        param: 'temperature',
        code: 'invalid_value',
      };
      upstream = () => json({ error }, 400);
      const resp = await post(ask({ temperature: 9 }));
      expect(resp.status).toBe(400);
      expect(await resp.json()).toEqual({ error });
    });

    it('unwraps the one-element array Gemini returns', () => {
      const raw = JSON.stringify([
        { error: { code: 400, message: 'Bad model', status: 'INVALID_ARGUMENT' } },
      ]);
      expect(upstreamErrorBody(raw)).toEqual({
        error: { code: 400, message: 'Bad model', status: 'INVALID_ARGUMENT' },
      });
    });

    it('wraps a non-JSON error body in an upstream_error', async () => {
      upstream = () => new Response('Bad Request', { status: 400 });
      const resp = await post(ask());
      expect(resp.status).toBe(400);
      expect((await resp.json()).error).toEqual({
        message: 'Upstream error: Bad Request',
        type: 'upstream_error',
      });
    });
  });
});
