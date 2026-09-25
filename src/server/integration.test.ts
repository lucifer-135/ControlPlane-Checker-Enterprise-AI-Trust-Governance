/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Integration tests: mount the real Express app (auth middleware, RBAC, tenant
 * scoping, routes) on an ephemeral port and drive it over HTTP.
 *
 * Isolation: the database is in-memory (vitest.setup.ts sets
 * CONTROLPLANE_DB_PATH=':memory:') and policies live in a temp directory, so
 * nothing in the working tree is written. Upstream LLM calls go to a stubbed
 * global fetch; the test client uses the real fetch captured at import time.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createApp, type CreatedApp } from './app.js';
import { createNewApiKey, initDatabase } from './db/database.js';
import { getUpstreamBreaker, buildModelCandidates } from './gateway.js';
import { DuplicatePolicyError } from './policyLoader.js';
import { getPrometheusMetricsText } from './telemetry.js';

vi.mock('./judge.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, sleep: vi.fn().mockResolvedValue(undefined) };
});

const realFetch = globalThis.fetch;

interface RunningApp extends CreatedApp {
  base: string;
  close: () => Promise<void>;
}

async function startApp(options: Parameters<typeof createApp>[0]): Promise<RunningApp> {
  const created = createApp(options);
  const server = http.createServer(created.app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    ...created,
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        created.stop();
        server.close(() => resolve());
      }),
  };
}

function upstreamCompletion(content: string) {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-integration',
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('Integration: real Express app in required auth mode', () => {
  let policiesDir: string;
  let running: RunningApp;
  let upstreamCalls: { url: string; model: string }[];
  let upstreamHandler: (model: string) => Response;
  const keys: Record<string, string> = {};

  const call = (method: string, route: string, key?: string, body?: unknown): Promise<Response> =>
    realFetch(`${running.base}${route}`, {
      method,
      headers: {
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  beforeAll(async () => {
    initDatabase(':memory:');
    process.env.GEMINI_API_KEY = 'mock-gemini-key-for-tests';
    process.env.OPENAI_API_KEY = 'mock-openai-key-for-tests';
    policiesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-integration-policies-'));

    keys.adminA = createNewApiKey('org_a', 'ws1', '', 'support_bot', 1000, 'admin').rawKey;
    keys.reviewerA = createNewApiKey('org_a', 'ws1', '', 'support_bot', 1000, 'reviewer').rawKey;
    keys.viewerA = createNewApiKey('org_a', 'ws1', '', 'support_bot', 1000, 'viewer').rawKey;
    keys.serviceA = createNewApiKey('org_a', 'ws1', '', 'support_bot', 1000, 'service').rawKey;
    keys.viewerB = createNewApiKey('org_b', 'ws1', '', 'support_bot', 1000, 'viewer').rawKey;
    keys.reviewerB = createNewApiKey('org_b', 'ws1', '', 'support_bot', 1000, 'reviewer').rawKey;

    running = await startApp({ authMode: 'required', policiesDir });
  });

  afterAll(async () => {
    await running.close();
    fs.rmSync(policiesDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    upstreamCalls = [];
    upstreamHandler = () => upstreamCompletion('Hello! How can I help?');
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      const model = JSON.parse(init?.body || '{}').model;
      upstreamCalls.push({ url: String(url), model });
      return upstreamHandler(model);
    }) as any;
    getUpstreamBreaker().reset();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  // ── Authentication & authorization ──

  it('keeps /api/health public and reports the auth mode', async () => {
    const resp = await call('GET', '/api/health');
    expect(resp.status).toBe(200);
    expect((await resp.json()).authMode).toBe('required');
  });

  it('rejects unauthenticated requests on API, event, and proxy routes', async () => {
    for (const [method, route] of [
      ['GET', '/api/policies'],
      ['GET', '/api/gateway/events'],
      ['GET', '/api/gateway/escalations'],
      ['GET', '/api/audit-logs'],
      ['POST', '/api/keys'],
      ['POST', '/v1/chat/completions'],
    ]) {
      const resp = await call(method, route, undefined, method === 'POST' ? {} : undefined);
      expect(resp.status, `${method} ${route}`).toBe(401);
    }
  });

  it('enforces roles on administrative and review routes', async () => {
    expect((await call('GET', '/api/gateway/events', keys.serviceA)).status).toBe(403);
    expect((await call('GET', '/api/gateway/events', keys.viewerA)).status).toBe(200);
    expect(
      (await call('PUT', '/api/policies/support_bot', keys.viewerA, { thresholds: {} })).status,
    ).toBe(403);
    expect((await call('POST', '/api/policies/reset', keys.reviewerA)).status).toBe(403);
    expect(
      (
        await call('POST', '/api/review-decisions', keys.viewerA, {
          id: 'x',
          interaction_id: 'y',
          reviewer: 'z',
          action: 'CONFIRM_BLOCK',
        })
      ).status,
    ).toBe(403);
    expect((await call('GET', '/api/audit-logs/verify', keys.viewerA)).status).toBe(403);
  });

  it('attributes review decisions to the authenticated key, not a client-supplied name', async () => {
    const resp = await call('POST', '/api/review-decisions', keys.reviewerA, {
      id: 'dec-identity-test',
      interaction_id: 'int-identity-test',
      reviewer: 'Someone Else Entirely',
      action: 'CONFIRM_BLOCK',
      notes: '',
      original_verdict: 'BLOCK_ESCALATE',
      new_verdict: 'BLOCK_ESCALATE',
      primary_trigger_lane: 'Responsibility',
    });
    expect(resp.status).toBe(200);
    const { decision } = await resp.json();
    expect(decision.reviewer).not.toContain('Someone Else');
    expect(decision.reviewer).toContain('org_a/ws1');

    const stored = await (
      await call('GET', '/api/review-decisions?interactionId=int-identity-test', keys.viewerA)
    ).json();
    expect(stored[0].reviewer).toBe(decision.reviewer);
  });

  it('limits key creation to the admin’s own org', async () => {
    const crossOrg = await call('POST', '/api/keys', keys.adminA, { orgId: 'org_b' });
    expect(crossOrg.status).toBe(403);

    const ownOrg = await call('POST', '/api/keys', keys.adminA, { role: 'viewer' });
    expect(ownOrg.status).toBe(200);
    const created = await ownOrg.json();
    expect(created.keyInfo.org_id).toBe('org_a');
    expect(created.keyInfo.role).toBe('viewer');
  });

  // ── Policy persistence ──

  it('persists admin policy edits to the configured policies directory', async () => {
    const resp = await call('PUT', '/api/policies/support_bot', keys.adminA, {
      thresholds: { block_escalate: 0.42 },
    });
    expect(resp.status).toBe(200);
    const yaml = fs.readFileSync(path.join(policiesDir, 'support-bot.yaml'), 'utf-8');
    expect(yaml).toContain('block_escalate: 0.42');
    expect(yaml).toContain('fail_mode:');

    const reloaded = await (await call('GET', '/api/policies', keys.viewerA)).json();
    expect(reloaded.support_bot.thresholds.block_escalate).toBe(0.42);

    const invalid = await call('PUT', '/api/policies/support_bot', keys.adminA, {
      thresholds: { block_escalate: 'high' },
    });
    expect(invalid.status).toBe(400);

    await call('POST', '/api/policies/reset', keys.adminA);
  });

  // ── Gateway → events → review queue ──

  it('scopes gateway events, audit logs, and escalations to the caller’s tenant with redacted payloads', async () => {
    upstreamHandler = () => upstreamCompletion('The customer SSN is 078-05-1120.');
    const proxy = await call('POST', '/v1/chat/completions', keys.serviceA, {
      model: 'gemini-3.6-flash',
      messages: [
        { role: 'user', content: 'Email my account summary to jane.doe@example.com please' },
      ],
    });
    expect(proxy.status).toBe(200);
    expect(proxy.headers.get('x-controlplane-tenant')).toBe('org_a');
    expect(proxy.headers.get('x-controlplane-verdict')).toBe('BLOCK_ESCALATE');

    // Tenant A sees the event, with PII removed from prompt, response, and spans
    const eventsA = await (await call('GET', '/api/gateway/events?limit=500', keys.viewerA)).json();
    const event = eventsA.events.find((e: any) => e.tenantOrgId === 'org_a');
    expect(event).toBeDefined();
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain('078-05-1120');
    expect(serialized).not.toContain('jane.doe@example.com');
    expect(event.interaction.response).toContain('[REDACTED_SSN]');
    expect(event.interaction.prompt).toContain('[REDACTED_EMAIL]');
    expect(typeof eventsA.epoch).toBe('string');

    // Tenant B sees none of tenant A's traffic
    const eventsB = await (await call('GET', '/api/gateway/events?limit=500', keys.viewerB)).json();
    expect(eventsB.events.some((e: any) => e.tenantOrgId === 'org_a')).toBe(false);

    // Audit logs are tenant-stamped and tenant-filtered
    const auditA = await (await call('GET', '/api/audit-logs', keys.viewerA)).json();
    expect(auditA.logs.some((l: any) => l.interaction_id === event.interaction.id)).toBe(true);
    const auditB = await (await call('GET', '/api/audit-logs', keys.viewerB)).json();
    expect(auditB.logs.some((l: any) => l.interaction_id === event.interaction.id)).toBe(false);

    // The escalation is pending for tenant A only
    const pendingA = await (await call('GET', '/api/gateway/escalations', keys.viewerA)).json();
    expect(pendingA.escalations.map((e: any) => e.interaction.id)).toContain(event.interaction.id);
    const pendingB = await (await call('GET', '/api/gateway/escalations', keys.viewerB)).json();
    expect(pendingB.escalations.map((e: any) => e.interaction.id)).not.toContain(
      event.interaction.id,
    );

    // Another tenant's reviewer cannot decide it
    const decision = {
      id: `dec-${event.interaction.id}`,
      interaction_id: event.interaction.id,
      reviewer: 'alice',
      action: 'CONFIRM_BLOCK',
      notes: 'confirmed',
      original_verdict: 'BLOCK_ESCALATE',
      new_verdict: 'BLOCK_ESCALATE',
      primary_trigger_lane: 'Responsibility',
      reviewed_at: new Date().toISOString(),
    };
    expect((await call('POST', '/api/review-decisions', keys.reviewerB, decision)).status).toBe(
      404,
    );

    // Once reviewed, it is no longer pending
    expect((await call('POST', '/api/review-decisions', keys.reviewerA, decision)).status).toBe(
      200,
    );
    const pendingAfter = await (await call('GET', '/api/gateway/escalations', keys.viewerA)).json();
    expect(pendingAfter.escalations.map((e: any) => e.interaction.id)).not.toContain(
      event.interaction.id,
    );

    // Decisions are append-only: no overwrite, no delete route
    expect((await call('POST', '/api/review-decisions', keys.reviewerA, decision)).status).toBe(
      409,
    );
    expect((await call('DELETE', `/api/review-decisions/${decision.id}`, keys.adminA)).status).toBe(
      404,
    );
    expect((await call('DELETE', '/api/review-decisions', keys.adminA)).status).toBe(404);
  });

  it('resets a stale event cursor from a previous server epoch', async () => {
    await call('POST', '/v1/chat/completions', keys.serviceA, {
      model: 'gemini-3.6-flash',
      messages: [{ role: 'user', content: 'Hello there' }],
    });
    const resp = await call(
      'GET',
      '/api/gateway/events?after=999999&epoch=previous-process',
      keys.viewerA,
    );
    const page = await resp.json();
    expect(page.reset).toBe(true);
    expect(page.events.length).toBeGreaterThan(0);
    expect(page.epoch).not.toBe('previous-process');

    // A current cursor is honoured
    const current = await (
      await call(
        'GET',
        `/api/gateway/events?after=${page.currentSeq}&epoch=${page.epoch}`,
        keys.viewerA,
      )
    ).json();
    expect(current.reset).toBe(false);
    expect(current.events).toHaveLength(0);
  });

  // ── Evaluation side effects ──

  it('does not write audit records for dashboard batch simulations', async () => {
    const before = (await (await call('GET', '/api/audit-logs?limit=500', keys.adminA)).json()).logs
      .length;
    const resp = await call('POST', '/api/evaluate/batch', keys.viewerA, {});
    expect(resp.status).toBe(200);
    const after = (await (await call('GET', '/api/audit-logs?limit=500', keys.adminA)).json()).logs
      .length;
    expect(after).toBe(before);
  });

  it('validates manual baseline observations', async () => {
    const bad = await call('POST', '/api/baselines/observe', keys.adminA, {
      useCase: 'support_bot',
      queryType: 'refund_policy',
      totalTokens: -5,
      latencyMs: 100,
    });
    expect(bad.status).toBe(400);
    const unknown = await call('POST', '/api/baselines/observe', keys.adminA, {
      useCase: 'not_a_use_case',
      queryType: 'x',
      totalTokens: 5,
      latencyMs: 100,
    });
    expect(unknown.status).toBe(400);
  });

  // ── Circuit breaker & provider fallbacks ──

  it('FAIL_OPEN with an open breaker serves a fallback without calling upstream', async () => {
    const breaker = getUpstreamBreaker();
    for (let i = 0; i < 5; i++) breaker.recordFailure();
    expect(breaker.getState()).toBe('OPEN');

    const resp = await call('POST', '/v1/chat/completions', keys.serviceA, {
      model: 'gemini-3.6-flash',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.governance.mode).toBe('FAIL_OPEN');
    expect(upstreamCalls).toHaveLength(0);
  });

  it('counts each breaker trip once in Prometheus metrics', async () => {
    const tripsBefore = Number(
      getPrometheusMetricsText().match(/controlplane_circuit_breaker_trips_total (\d+)/)![1],
    );
    const breaker = getUpstreamBreaker();
    for (let i = 0; i < 8; i++) breaker.recordFailure();
    const tripsAfter = Number(
      getPrometheusMetricsText().match(/controlplane_circuit_breaker_trips_total (\d+)/)![1],
    );
    expect(tripsAfter).toBe(tripsBefore + 1);
  });

  it('a half-open breaker allows exactly one bounded probe', async () => {
    const breaker = getUpstreamBreaker();
    for (let i = 0; i < 5; i++) breaker.recordFailure();
    const realNow = Date.now;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 60_000);
    try {
      upstreamHandler = () => new Response('overloaded', { status: 503 });
      const resp = await call('POST', '/v1/chat/completions', keys.serviceA, {
        model: 'gemini-3.6-flash',
        messages: [{ role: 'user', content: 'Hello' }],
      });
      expect(resp.status).toBe(200); // FAIL_OPEN fallback
      expect(upstreamCalls).toHaveLength(1);
      expect(breaker.getState()).toBe('OPEN');
    } finally {
      spy.mockRestore();
    }
  });

  it('only falls back to models of the same provider', async () => {
    upstreamHandler = () => new Response('model not found', { status: 404 });
    const resp = await call('POST', '/v1/chat/completions', keys.serviceA, {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(resp.status).toBe(200);
    expect(upstreamCalls.length).toBeGreaterThan(0);
    for (const c of upstreamCalls) {
      expect(c.url).toContain('api.openai.com');
      expect(c.model).not.toMatch(/gemini/);
    }

    expect(buildModelCandidates('claude-sonnet-5').every((m) => !m.includes('gemini'))).toBe(true);
    expect(buildModelCandidates('gemini-3.6-flash').every((m) => m.includes('gemini'))).toBe(true);
  });
});

describe('Integration: local-dev auth mode', () => {
  it('allows unauthenticated local-dev access but still validates presented keys', async () => {
    const policiesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-integration-dev-'));
    const running = await startApp({ authMode: 'dev', policiesDir });
    try {
      const open = await realFetch(`${running.base}/api/policies`);
      expect(open.status).toBe(200);

      const badKey = await realFetch(`${running.base}/api/policies`, {
        headers: { Authorization: 'Bearer cp_live_not_a_real_key' },
      });
      expect(badKey.status).toBe(401);
    } finally {
      await running.close();
      fs.rmSync(policiesDir, { recursive: true, force: true });
    }
  });

  it('refuses to start when two policy files define the same use case', () => {
    const policiesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-integration-dup-'));
    try {
      fs.writeFileSync(path.join(policiesDir, 'a.yaml'), 'use_case: support_bot\n');
      fs.writeFileSync(path.join(policiesDir, 'b.yaml'), 'use_case: support_bot\n');
      expect(() => createApp({ authMode: 'dev', policiesDir })).toThrow(DuplicatePolicyError);
    } finally {
      fs.rmSync(policiesDir, { recursive: true, force: true });
    }
  });
});
