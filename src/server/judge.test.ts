import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  normalizeJudgeOutput,
  generateDynamicJudgeFallback,
  executeDualJudge,
  calculateBackoffWithJitter,
  isRetryableGeminiError,
  GEMINI_MODELS,
  SingleJudgeResult,
} from './judge.js';

describe('LLM Judge Engine', () => {
  const mockOptions = {
    prompt: 'What is the return rate of Alpha Fund?',
    retrievedContext: 'Alpha Fund returns are not guaranteed and varied between 5-7%.',
    responseText: 'Alpha Fund has an absolutely guaranteed 15% return.',
    useCase: 'decision_support' as const,
  };

  const dummyFallback: SingleJudgeResult = {
    isLiveLLM: false,
    provider: 'fallback',
    modelUsed: 'dummy-fallback',
    verdict: 'CONFIDENTLY_WRONG',
    groundednessScore: 0.1,
    certaintyScore: 0.9,
    certaintySupportMismatch: 0.8,
    reasoning: 'Fallback reasoning',
    triggeringSpans: ['guaranteed 15%'],
    latencyMs: 10,
  };

  describe('normalizeJudgeOutput', () => {
    it('normalizes valid JSON object correctly', () => {
      const raw = {
        groundednessScore: 0.2,
        certaintyScore: 0.95,
        certaintySupportMismatch: 0.75,
        verdict: 'CONFIDENTLY_WRONG',
        reasoning: 'The response asserts guaranteed return contrary to context.',
        triggeringSpans: ['absolutely guaranteed 15%'],
      };

      const result = normalizeJudgeOutput(raw, 'qwen', 'qwen2.5:7b', 450, dummyFallback);
      expect(result.isLiveLLM).toBe(true);
      expect(result.provider).toBe('qwen');
      expect(result.modelUsed).toBe('qwen2.5:7b');
      expect(result.verdict).toBe('CONFIDENTLY_WRONG');
      expect(result.groundednessScore).toBe(0.2);
      expect(result.certaintyScore).toBe(0.95);
      expect(result.certaintySupportMismatch).toBe(0.75);
      expect(result.reasoning).toContain('asserts guaranteed return');
      expect(result.triggeringSpans).toEqual(['absolutely guaranteed 15%']);
      expect(result.latencyMs).toBe(450);
    });

    it('strips markdown ```json fences and parses string output', () => {
      const markdownJson = `\`\`\`json
{
  "groundednessScore": 0.85,
  "certaintyScore": 0.8,
  "certaintySupportMismatch": 0.05,
  "verdict": "SUPPORTED",
  "reasoning": "Well supported by reference text.",
  "triggeringSpans": []
}
\`\`\``;

      const result = normalizeJudgeOutput(
        markdownJson,
        'gemini',
        'gemini-3.6-flash',
        320,
        dummyFallback,
      );
      expect(result.isLiveLLM).toBe(true);
      expect(result.verdict).toBe('SUPPORTED');
      expect(result.groundednessScore).toBe(0.85);
      expect(result.modelUsed).toBe('gemini-3.6-flash');
    });

    it('falls back gracefully on invalid JSON', () => {
      const result = normalizeJudgeOutput(
        'Not valid JSON at all!',
        'qwen',
        'qwen2.5:7b',
        100,
        dummyFallback,
      );
      expect(result).toEqual(dummyFallback);
    });
  });

  describe('generateDynamicJudgeFallback', () => {
    it('generates deterministic score and verdict from performance lane', () => {
      const fallback = generateDynamicJudgeFallback(mockOptions);
      expect(fallback.isLiveLLM).toBe(false);
      expect(fallback.provider).toBe('fallback');
      expect(['SUPPORTED', 'AMBIGUOUS', 'CONFIDENTLY_WRONG', 'UNSUPPORTED']).toContain(
        fallback.verdict,
      );
      expect(fallback.groundednessScore).toBeGreaterThanOrEqual(0);
      expect(fallback.groundednessScore).toBeLessThanOrEqual(1);
    });
  });

  describe('executeDualJudge', () => {
    it('computes consensus agreement when both judges have identical verdict', async () => {
      // Mock global fetch for Ollama
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              groundednessScore: 0.1,
              certaintyScore: 0.9,
              certaintySupportMismatch: 0.8,
              verdict: 'CONFIDENTLY_WRONG',
              reasoning: 'Local Qwen says confidently wrong',
              triggeringSpans: ['guaranteed'],
            }),
          },
        }),
      });

      // Mock Gemini AI client
      const mockAi: any = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: JSON.stringify({
              groundednessScore: 0.15,
              certaintyScore: 0.85,
              certaintySupportMismatch: 0.7,
              verdict: 'CONFIDENTLY_WRONG',
              reasoning: 'Gemini agrees confidently wrong',
              triggeringSpans: ['15% return'],
            }),
          }),
        },
      };

      const dual = await executeDualJudge(mockOptions, mockAi);

      expect(dual.provider).toBe('dual');
      expect(dual.consensus).toBe('AGREED');
      expect(dual.verdict).toBe('CONFIDENTLY_WRONG');
      expect(dual.consensusNote).toContain('Consensus Reached');
      expect(dual.dualResults.gemini.verdict).toBe('CONFIDENTLY_WRONG');
      expect(dual.dualResults.local.verdict).toBe('CONFIDENTLY_WRONG');
      expect(dual.scoreDeltas.groundednessDelta).toBe(0.05);
      expect(dual.triggeringSpans).toContain('guaranteed');
      expect(dual.triggeringSpans).toContain('15% return');
    });

    it('detects discrepancy when judges disagree', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              groundednessScore: 0.6,
              certaintyScore: 0.5,
              certaintySupportMismatch: 0.2,
              verdict: 'AMBIGUOUS',
              reasoning: 'Qwen says ambiguous overlap',
              triggeringSpans: [],
            }),
          },
        }),
      });

      const mockAi: any = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: JSON.stringify({
              groundednessScore: 0.95,
              certaintyScore: 0.8,
              certaintySupportMismatch: 0.05,
              verdict: 'SUPPORTED',
              reasoning: 'Gemini says fully supported',
              triggeringSpans: [],
            }),
          }),
        },
      };

      const dual = await executeDualJudge(mockOptions, mockAi);

      expect(dual.consensus).toBe('DISAGREED');
      expect(dual.consensusNote).toContain('Model Discrepancy');
      // Takes more conservative verdict (AMBIGUOUS over SUPPORTED)
      expect(dual.verdict).toBe('AMBIGUOUS');
    });
  });

  describe('Resilience, Backoff, and Model Governance', () => {
    it('computes exponential backoff with jitter within defined bounds', () => {
      // Attempt 0: base 2000ms +- 500ms -> [1500, 2500]
      const delay0 = calculateBackoffWithJitter(0, 2000, 16000, 500);
      expect(delay0).toBeGreaterThanOrEqual(1500);
      expect(delay0).toBeLessThanOrEqual(2500);

      // Attempt 1: 4000ms +- 500ms -> [3500, 4500]
      const delay1 = calculateBackoffWithJitter(1, 2000, 16000, 500);
      expect(delay1).toBeGreaterThanOrEqual(3500);
      expect(delay1).toBeLessThanOrEqual(4500);

      // Attempt 2: 8000ms +- 500ms -> [7500, 8500]
      const delay2 = calculateBackoffWithJitter(2, 2000, 16000, 500);
      expect(delay2).toBeGreaterThanOrEqual(7500);
      expect(delay2).toBeLessThanOrEqual(8500);

      // Respects max delay cap
      const delayCap = calculateBackoffWithJitter(10, 2000, 16000, 500);
      expect(delayCap).toBeLessThanOrEqual(16500);
    });

    it('identifies transient retryable errors vs non-retryable errors correctly', () => {
      // Retryable capacity and rate limit spikes
      expect(isRetryableGeminiError({ status: 503, message: 'UNAVAILABLE' })).toBe(true);
      expect(isRetryableGeminiError({ code: 429, message: 'Resource exhausted' })).toBe(true);
      expect(
        isRetryableGeminiError({ message: 'This model is currently experiencing high demand' }),
      ).toBe(true);
      expect(isRetryableGeminiError({ message: 'fetch failed: ECONNRESET' })).toBe(true);

      // Non-retryable errors (should not retry repeatedly)
      expect(
        isRetryableGeminiError({
          status: 404,
          message: 'models/gemini-2.0-flash is no longer available',
        }),
      ).toBe(false);
      expect(isRetryableGeminiError({ status: 400, message: 'Invalid argument' })).toBe(false);
      expect(isRetryableGeminiError({ status: 401, message: 'API key not valid' })).toBe(false);
    });

    it('targets stable production Gemini models without unstable preview tags', () => {
      expect(GEMINI_MODELS.length).toBeGreaterThan(0);
      for (const m of GEMINI_MODELS) {
        expect(m).not.toContain('-preview');
        expect(m).not.toContain('-lite-preview');
      }
    });
  });
});
