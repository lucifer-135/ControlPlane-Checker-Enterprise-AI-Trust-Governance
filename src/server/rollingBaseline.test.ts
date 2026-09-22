/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { RollingBaselineTracker } from './rollingBaseline.js';

describe('RollingBaselineTracker (Welford Algorithm)', () => {
  it('initializes with seed baselines', () => {
    const tracker = new RollingBaselineTracker(true);
    const baseline = tracker.getBaseline('support_bot', 'refund_policy');

    expect(baseline).toBeDefined();
    expect(baseline.mean_tokens).toBeGreaterThan(100);
    expect(baseline.stddev_tokens).toBeGreaterThan(0);
    expect(baseline.mean_latency_ms).toBeGreaterThan(100);
  });

  it('updates mean and variance correctly with new observations in O(1)', () => {
    const tracker = new RollingBaselineTracker(false); // start empty
    // Feed 3 values: 100, 200, 300
    // Mean = 200, Sample Variance = ((100-200)^2 + (200-200)^2 + (300-200)^2) / (3-1) = 20000 / 2 = 10000
    // StdDev = sqrt(10000) = 100
    tracker.recordObservation('support_bot', 'test_query', 100, 50);
    tracker.recordObservation('support_bot', 'test_query', 200, 100);
    tracker.recordObservation('support_bot', 'test_query', 300, 150);

    const baseline = tracker.getBaseline('support_bot', 'test_query');
    expect(baseline.mean_tokens).toBe(200);
    expect(baseline.stddev_tokens).toBe(100);
    expect(baseline.mean_latency_ms).toBe(100);
    expect(baseline.stddev_latency_ms).toBe(50);
  });

  it('serializes to JSON and restores state', () => {
    const tracker = new RollingBaselineTracker(false);
    tracker.recordObservation('internal_copilot', 'doc_search', 500, 800);
    tracker.recordObservation('internal_copilot', 'doc_search', 600, 900);

    const json = tracker.toJSON();
    const restored = new RollingBaselineTracker(false);
    restored.fromJSON(json);

    const b = restored.getBaseline('internal_copilot', 'doc_search');
    expect(b.mean_tokens).toBe(550);
    expect(b.mean_latency_ms).toBe(850);
  });
});
