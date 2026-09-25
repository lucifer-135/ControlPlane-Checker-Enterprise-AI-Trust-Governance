/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  evaluateCostLane,
  setGlobalBaselineGetter,
  resetGlobalBaselineGetter,
} from './costLane.js';
import { globalBaselineTracker, resetGlobalBaselineTracker } from '../rollingBaseline.js';
import type { QueryBaseline } from '../../data/baselines.js';

describe('Cost Lane Evaluator (evaluateCostLane)', () => {
  beforeEach(() => {
    resetGlobalBaselineTracker();
    resetGlobalBaselineGetter();
  });

  it('evaluates normal resource consumption within baseline standard deviations', () => {
    // support_bot:refund_policy default baseline: mean_tokens: 165, stddev: 35, mean_latency: 320, stddev: 60
    const result = evaluateCostLane(
      { prompt: 80, completion: 90, total: 170 },
      330,
      'support_bot',
      'refund_policy',
    );

    expect(result.lane).toBe('cost');
    expect(result.is_outlier).toBe(false);
    expect(result.is_runaway_loop).toBe(false);
    expect(result.combined_z_score).toBeLessThan(1.0);
    expect(result.risk_score).toBeLessThan(0.3);
    expect(result.explanation).toContain('Normal resource consumption');
  });

  it('flags token and latency outliers exceeding the Z-score cutoff', () => {
    // Total tokens 350 vs mean 165 (Z = (350-165)/35 = 5.28)
    const result = evaluateCostLane(
      { prompt: 150, completion: 200, total: 350 },
      320,
      'support_bot',
      'refund_policy',
      0,
      2.0,
    );

    expect(result.is_outlier).toBe(true);
    expect(result.token_z_score).toBeGreaterThan(2.0);
    expect(result.combined_z_score).toBeGreaterThan(2.0);
    expect(result.risk_score).toBeGreaterThan(0.5);
    expect(result.explanation).toContain('Resource Outlier');
  });

  it('flags runaway loop when tool calls exceed safety threshold', () => {
    const result = evaluateCostLane(
      { prompt: 50, completion: 50, total: 100 },
      250,
      'support_bot',
      'refund_policy',
      4, // >= 4 sequential tool retries
    );

    expect(result.is_runaway_loop).toBe(true);
    expect(result.is_outlier).toBe(true);
    expect(result.risk_score).toBe(0.95);
    expect(result.explanation).toContain('Critical Runaway Loop Alert: 4 sequential tool retries');
  });

  it('flags runaway loop when completion tokens explode past 3.5x mean', () => {
    // Baseline mean = 165. 165 * 3.5 = 577.5. Completion = 600.
    const result = evaluateCostLane(
      { prompt: 50, completion: 600, total: 650 },
      400,
      'support_bot',
      'refund_policy',
    );

    expect(result.is_runaway_loop).toBe(true);
    expect(result.risk_score).toBe(0.95);
    expect(result.explanation).toContain('Token explosion');
  });

  it('dynamically adapts evaluation scores when globalBaselineTracker receives observations', () => {
    const testUsage = { prompt: 150, completion: 200, total: 350 };
    const testLatency = 320;

    // Step 1: Initial evaluation with seeded default baseline (mean = 165 tokens)
    const initialResult = evaluateCostLane(
      testUsage,
      testLatency,
      'support_bot',
      'refund_policy',
      0,
      2.0,
    );
    expect(initialResult.is_outlier).toBe(true);
    expect(initialResult.token_z_score).toBeGreaterThan(5.0);

    // Step 2: Feed new observations into global rolling baseline tracker (simulating /api/baselines/observe)
    // Shift the distribution to represent higher token workloads for this query type
    for (let i = 0; i < 5000; i++) {
      globalBaselineTracker.recordObservation('support_bot', 'refund_policy', 360, 320);
    }

    // Step 3: Re-evaluate the exact same request with the updated rolling tracker
    const updatedResult = evaluateCostLane(
      testUsage,
      testLatency,
      'support_bot',
      'refund_policy',
      0,
      2.0,
    );

    // Baseline should now reflect the new higher mean
    expect(updatedResult.baseline_mean_tokens).toBeGreaterThan(250);
    // The Z-score should drop significantly and no longer trigger the outlier alarm
    expect(updatedResult.token_z_score).toBeLessThan(initialResult.token_z_score);
    expect(updatedResult.is_outlier).toBe(false);
  });

  it('respects an explicitly provided baselineGetter parameter override', () => {
    const customBaseline: QueryBaseline = {
      use_case: 'support_bot',
      query_type: 'custom_type',
      mean_tokens: 1000,
      stddev_tokens: 200,
      mean_latency_ms: 2000,
      stddev_latency_ms: 400,
      sample_size: 50,
    };

    const customGetter = () => customBaseline;

    const result = evaluateCostLane(
      { prompt: 500, completion: 500, total: 1000 },
      2000,
      'support_bot',
      'custom_type',
      0,
      2.0,
      customGetter,
    );

    expect(result.baseline_mean_tokens).toBe(1000);
    expect(result.token_z_score).toBe(0.0);
    expect(result.latency_z_score).toBe(0.0);
    expect(result.is_outlier).toBe(false);
  });

  it('allows setting and resetting the active global baseline getter', () => {
    const mockBaseline: QueryBaseline = {
      use_case: 'internal_copilot',
      query_type: 'code_refactor',
      mean_tokens: 9999,
      stddev_tokens: 100,
      mean_latency_ms: 9999,
      stddev_latency_ms: 100,
      sample_size: 10,
    };

    setGlobalBaselineGetter(() => mockBaseline);

    const mockedResult = evaluateCostLane(
      { prompt: 100, completion: 100, total: 200 },
      500,
      'internal_copilot',
      'code_refactor',
    );
    expect(mockedResult.baseline_mean_tokens).toBe(9999);

    resetGlobalBaselineGetter();

    const restoredResult = evaluateCostLane(
      { prompt: 100, completion: 100, total: 200 },
      500,
      'internal_copilot',
      'code_refactor',
    );
    expect(restoredResult.baseline_mean_tokens).toBeLessThan(1000);
  });
});

describe('Cost lane cutoff scaling', () => {
  const baseline: QueryBaseline = {
    use_case: 'support_bot',
    query_type: 'fixed',
    mean_tokens: 100,
    stddev_tokens: 10,
    mean_latency_ms: 100,
    stddev_latency_ms: 10,
    sample_size: 100,
  };
  const getter = () => baseline;

  it('maps Z = cutoff to 0.5 risk, so a stricter cutoff raises risk', () => {
    const usage = { prompt: 50, completion: 80, total: 130 }; // Z = 3
    const lenient = evaluateCostLane(usage, 100, 'support_bot', 'fixed', 0, 3.0, getter);
    const strict = evaluateCostLane(usage, 100, 'support_bot', 'fixed', 0, 1.5, getter);
    expect(lenient.risk_score).toBeCloseTo(0.5, 3);
    expect(strict.risk_score).toBeCloseTo(1.0, 3);
    expect(lenient.is_outlier).toBe(true);
  });

  it('is unchanged (Z / 4) at the default cutoff of 2.0', () => {
    const usage = { prompt: 50, completion: 60, total: 110 }; // Z = 1
    const result = evaluateCostLane(usage, 100, 'support_bot', 'fixed', 0, 2.0, getter);
    expect(result.risk_score).toBeCloseTo(0.25, 3);
  });
});
