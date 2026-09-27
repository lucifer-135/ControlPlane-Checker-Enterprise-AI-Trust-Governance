/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  clearJudgeCache,
  evaluateJudgeRequest,
  executeGeminiJudge,
  GEMINI_MODELS,
  type GeminiJudgeTiming,
} from './judge.js';

const VERDICT = JSON.stringify({
  groundednessScore: 0.1,
  certaintyScore: 0.9,
  certaintySupportMismatch: 0.81,
  verdict: 'CONFIDENTLY_WRONG',
  reasoning: 'Contradicts the refund policy.',
  triggeringSpans: ['100% refund'],
});

const OPTIONS = {
  prompt: 'Refund?',
  retrievedContext: 'Quarterly plans are non-refundable after 14 days.',
  responseText: 'I guarantee a 100% refund.',
  useCase: 'support_bot' as const,
};

const FAST: GeminiJudgeTiming = { hedgeDelayMs: 50, attemptTimeoutMs: 400, totalBudgetMs: 800 };

type Behaviour = { delayMs?: number; fail?: string; hang?: boolean; rejectThinking?: boolean };

/** Fake Gemini client: each model answers, fails, or hangs as configured. */
function fakeClient(behaviours: Record<string, Behaviour>) {
  const calls: { model: string; config: any }[] = [];
  const generateContent = vi.fn(({ model, config }: any) => {
    calls.push({ model, config });
    const b = behaviours[model] ?? { fail: '503 high demand' };
    return new Promise((resolve, reject) => {
      config.abortSignal?.addEventListener('abort', () => reject(new Error('aborted')));
      if (b.rejectThinking && config.thinkingConfig) {
        return reject(
          Object.assign(new Error('Thinking level MINIMAL is not supported for this model'), {
            status: 400,
          }),
        );
      }
      if (b.hang) return;
      setTimeout(
        () => (b.fail ? reject(new Error(b.fail)) : resolve({ text: VERDICT })),
        b.delayMs ?? 0,
      );
    });
  });
  return { client: { models: { generateContent } } as any, calls };
}

const [primary, secondary, third] = GEMINI_MODELS;

describe('executeGeminiJudge latency control', () => {
  it('uses the primary model when it answers quickly, without starting a backup', async () => {
    const { client, calls } = fakeClient({ [primary]: { delayMs: 5 } });
    const result = await executeGeminiJudge(OPTIONS, client, FAST);
    expect(result.isLiveLLM).toBe(true);
    expect(result.modelUsed).toBe(primary);
    expect(calls.map((c) => c.model)).toEqual([primary]);
  });

  it('starts a backup when the primary is slow, and the faster answer wins', async () => {
    const { client, calls } = fakeClient({
      [primary]: { delayMs: 300 },
      [secondary]: { delayMs: 10 },
    });
    const start = Date.now();
    const result = await executeGeminiJudge(OPTIONS, client, FAST);
    expect(result.modelUsed).toBe(secondary);
    expect(Date.now() - start).toBeLessThan(250);
    expect(calls[0].config.abortSignal.aborted).toBe(true); // the slow call was cancelled
  });

  it('moves to the next model immediately when one fails', async () => {
    const { client } = fakeClient({
      [primary]: { fail: '503 high demand' },
      [secondary]: { delayMs: 5 },
    });
    const start = Date.now();
    const result = await executeGeminiJudge(OPTIONS, client, {
      ...FAST,
      hedgeDelayMs: 10_000,
    });
    expect(result.modelUsed).toBe(secondary);
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('never has more than three calls in flight', async () => {
    const { client, calls } = fakeClient(
      Object.fromEntries(GEMINI_MODELS.map((m) => [m, { hang: true }])),
    );
    await executeGeminiJudge(OPTIONS, client, {
      hedgeDelayMs: 20,
      attemptTimeoutMs: 5_000,
      totalBudgetMs: 200,
    });
    expect(calls.length).toBe(3);
  });

  it('falls back to the heuristic judge when the budget runs out', async () => {
    const { client } = fakeClient(
      Object.fromEntries(GEMINI_MODELS.map((m) => [m, { hang: true }])),
    );
    const start = Date.now();
    const result = await executeGeminiJudge(OPTIONS, client, FAST);
    expect(result.isLiveLLM).toBe(false);
    expect(Date.now() - start).toBeLessThan(FAST.totalBudgetMs + 200);
  });

  it('falls back when every model fails', async () => {
    const { client } = fakeClient({});
    const result = await executeGeminiJudge(OPTIONS, client, FAST);
    expect(result.isLiveLLM).toBe(false);
  });

  it('asks for minimal thinking and deterministic output', async () => {
    const { client, calls } = fakeClient({ [primary]: { delayMs: 1 } });
    await executeGeminiJudge(OPTIONS, client, FAST);
    expect(calls[0].config.temperature).toBe(0);
    expect(calls[0].config.thinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' });
  });

  it('retries without a thinking config when a model rejects it, and remembers', async () => {
    const model = third ?? primary;
    const behaviours = Object.fromEntries(
      GEMINI_MODELS.map((m) => [
        m,
        m === model ? { rejectThinking: true, delayMs: 1 } : { fail: '503' },
      ]),
    );
    const first = fakeClient(behaviours);
    expect((await executeGeminiJudge(OPTIONS, first.client, FAST)).modelUsed).toBe(model);
    const forModel = first.calls.filter((c) => c.model === model);
    expect(forModel.map((c) => !!c.config.thinkingConfig)).toEqual([true, false]);

    const second = fakeClient(behaviours);
    await executeGeminiJudge(OPTIONS, second.client, FAST);
    expect(
      second.calls.filter((c) => c.model === model).map((c) => !!c.config.thinkingConfig),
    ).toEqual([false]);
  });
});

describe('judge cache', () => {
  it('answers an identical request from the cache without calling the model again', async () => {
    clearJudgeCache();
    const { client, calls } = fakeClient({ [primary]: { delayMs: 1 } });
    const first = await evaluateJudgeRequest(OPTIONS, client);
    const second = await evaluateJudgeRequest(OPTIONS, client);
    expect(first.cached).toBeUndefined();
    expect(second).toMatchObject({
      cached: true,
      verdict: first.verdict,
      latencyMs: first.latencyMs,
    });
    expect(calls.length).toBe(1);
  });

  it('judges a different response separately', async () => {
    clearJudgeCache();
    const { client, calls } = fakeClient({ [primary]: { delayMs: 1 } });
    await evaluateJudgeRequest(OPTIONS, client);
    await evaluateJudgeRequest({ ...OPTIONS, responseText: 'A different answer.' }, client);
    expect(calls.length).toBe(2);
  });

  it('does not cache a heuristic fallback, so the next click retries the LLM', async () => {
    clearJudgeCache();
    const failing = fakeClient({});
    const fallback = await evaluateJudgeRequest(OPTIONS, failing.client);
    expect(fallback.isLiveLLM).toBe(false);
    const working = fakeClient({ [primary]: { delayMs: 1 } });
    const retried = await evaluateJudgeRequest(OPTIONS, working.client);
    expect(retried.isLiveLLM).toBe(true);
    expect(retried.cached).toBeUndefined();
  });
});
