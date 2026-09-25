/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { evaluateDataset, evaluateInteraction } from './decisionEngine';
import { DEFAULT_POLICY_PROFILES } from './policyProfiles';
import { SYNTHETIC_INTERACTIONS } from '../data/interactions';
import {
  LONG_CONTEXT_INTERACTIONS,
  estimateTokens,
  joinContextChunks,
} from '../data/longContextScenarios';
import { evaluateCostLane, MIN_BASELINE_SAMPLES } from './lanes/costLane';
import { evaluatePerformanceLane } from './lanes/performanceLane';
import type { SyntheticInteraction } from '../types';

describe('Long-context scenarios', () => {
  const { evaluations } = evaluateDataset(SYNTHETIC_INTERACTIONS, DEFAULT_POLICY_PROFILES);

  it('are production-shaped: system prompt, history, and many retrieved chunks', () => {
    for (const i of LONG_CONTEXT_INTERACTIONS) {
      expect(i.system_prompt!.length).toBeGreaterThan(500);
      expect(i.history!.length).toBeGreaterThan(0);
      expect(i.context_chunks!.length).toBeGreaterThanOrEqual(10);
      expect(i.token_count.total).toBeGreaterThan(1500);
      expect(i.retrieved_context).toBe(joinContextChunks(i.context_chunks!));
    }
  });

  it('have token counts derived from their actual text', () => {
    for (const i of LONG_CONTEXT_INTERACTIONS) {
      expect(i.token_count.completion).toBe(estimateTokens(i.response));
      expect(i.token_count.total).toBe(i.token_count.prompt + i.token_count.completion);
      expect(i.token_count.prompt).toBeGreaterThan(estimateTokens(i.retrieved_context!));
    }
  });

  it('produce the expected verdicts with the evidence buried in long context', () => {
    expect(evaluations['int-sb-011'].verdict).toBe('BLOCK_ESCALATE');
    expect(evaluations['int-ds-011'].verdict).toBe('BLOCK_ESCALATE');
    expect(evaluations['int-ds-011'].performance.is_confidently_wrong).toBe(true);
    expect(evaluations['int-ds-012'].verdict).toBe('BLOCK_ESCALATE');
    expect(evaluations['int-ds-012'].responsibility.bias_flags.length).toBeGreaterThan(0);
  });

  it('allows a clean, well-grounded long-context answer without false positives', () => {
    const clean = evaluations['int-ic-012'];
    expect(clean.verdict).toBe('ALLOW');
    expect(clean.performance.groundedness_score).toBeGreaterThan(0.8);
    expect(clean.cost.is_outlier).toBe(false);
  });

  it('treats facts the user stated in earlier turns as grounding', () => {
    const base: SyntheticInteraction = {
      id: 'hist',
      use_case: 'support_bot',
      session_id: 'h',
      turn_number: 2,
      query_type: 'refund_policy',
      prompt: 'Can you open the dispute?',
      history: [
        { role: 'user', content: 'Our invoice INV-7781 shows the Harbor Analytics fee twice.' },
      ],
      retrieved_context: 'Duplicate charges are resolved by opening a billing dispute.',
      response: 'I will open a billing dispute for Harbor Analytics on invoice INV-7781.',
      token_count: { prompt: 40, completion: 20, total: 60 },
      latency_ms: 300,
      ground_truth_labels: ['clean'],
      metadata: {},
    };
    const withHistory = evaluateInteraction(base, DEFAULT_POLICY_PROFILES.support_bot);
    const withoutHistory = evaluateInteraction(
      { ...base, history: [] },
      DEFAULT_POLICY_PROFILES.support_bot,
    );
    expect(withHistory.performance.groundedness_score).toBeGreaterThan(
      withoutHistory.performance.groundedness_score,
    );
  });

  it('evaluates a ~32k-token context quickly (linear scaling)', () => {
    const context = Array.from(
      { length: 1200 },
      (_, n) =>
        `Section ${n}.1: refund requests within 30 days of renewal receive a prorated credit; ticket INC-${n} closed.`,
    ).join(' ');
    expect(estimateTokens(context)).toBeGreaterThan(30_000);
    const start = performance.now();
    evaluatePerformanceLane(
      'Am I eligible for a refund?',
      context,
      'Per Section 1.1, refund requests within 30 days of renewal receive a prorated credit.',
      'support_bot',
    );
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe('Long-context grounding and cost fixes', () => {
  it('does not treat a number as grounded just because it appears inside another number', () => {
    const result = evaluatePerformanceLane(
      'When does the offer end?',
      'The promotion runs until 2030 for plans priced at 130 dollars.',
      'The promotion gives a 30 percent discount.',
      'support_bot',
    );
    expect(result.triggering_spans.some((s) => s.text === '30')).toBe(true);
  });

  it('does not Z-score a workload whose baseline is still warming up', () => {
    const warming = () => ({
      use_case: 'support_bot' as const,
      query_type: 'new_rag_workload',
      mean_tokens: 250,
      stddev_tokens: 60,
      mean_latency_ms: 450,
      stddev_latency_ms: 90,
      sample_size: MIN_BASELINE_SAMPLES - 1,
    });
    const result = evaluateCostLane(
      { prompt: 4000, completion: 300, total: 4300 },
      3500,
      'support_bot',
      'new_rag_workload',
      0,
      2.0,
      warming,
    );
    expect(result.is_outlier).toBe(false);
    expect(result.risk_score).toBe(0);
    expect(result.explanation).toContain('warming up');

    const runaway = evaluateCostLane(
      { prompt: 4000, completion: 300, total: 4300 },
      3500,
      'support_bot',
      'new_rag_workload',
      5,
      2.0,
      warming,
    );
    expect(runaway.is_runaway_loop).toBe(true);
  });
});
