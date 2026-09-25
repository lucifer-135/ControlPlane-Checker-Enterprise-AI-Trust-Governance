/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  RollingBaselineTracker,
  InvalidObservationError,
  BASELINE_SCHEMA_VERSION,
} from './rollingBaseline.js';

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

describe('RollingBaselineTracker safeguards', () => {
  it('rejects invalid observations', () => {
    const tracker = new RollingBaselineTracker(false);
    const bad: [any, any, any, any][] = [
      ['unknown_use_case', 'q', 10, 10],
      ['support_bot', 'has spaces!', 10, 10],
      ['support_bot', 'q', -1, 10],
      ['support_bot', 'q', 10, Number.NaN],
      ['support_bot', 'q', Number.POSITIVE_INFINITY, 10],
      ['support_bot', 'q', 5_000_000, 10],
    ];
    for (const args of bad) {
      expect(() => tracker.recordObservation(...args)).toThrow(InvalidObservationError);
    }
    expect(tracker.isDirty()).toBe(false);
  });

  it('winsorizes a single extreme outlier once the bucket is warm', () => {
    const tracker = new RollingBaselineTracker(false);
    for (let i = 0; i < 100; i++) {
      tracker.recordObservation('support_bot', 'warm', 100 + (i % 10), 200 + (i % 10));
    }
    const before = tracker.getBaseline('support_bot', 'warm');
    tracker.recordObservation('support_bot', 'warm', 900_000, 500_000);
    const after = tracker.getBaseline('support_bot', 'warm');
    // An unclamped update would move the mean by ~9,000 tokens
    expect(after.mean_tokens - before.mean_tokens).toBeLessThan(5);
    expect(after.mean_latency_ms - before.mean_latency_ms).toBeLessThan(5);
  });

  it('still adapts to a sustained shift', () => {
    const tracker = new RollingBaselineTracker(false);
    for (let i = 0; i < 200; i++)
      tracker.recordObservation('support_bot', 'shift', 100 + (i % 5), 100);
    for (let i = 0; i < 3000; i++) tracker.recordObservation('support_bot', 'shift', 300, 100);
    expect(tracker.getBaseline('support_bot', 'shift').mean_tokens).toBeGreaterThan(250);
  });

  it('serializes with a schema version and restores legacy v1 snapshots', () => {
    const tracker = new RollingBaselineTracker(false);
    tracker.recordObservation('support_bot', 'v', 100, 50);
    const snapshot = tracker.toJSON();
    expect(snapshot.schemaVersion).toBe(BASELINE_SCHEMA_VERSION);

    const legacy = new RollingBaselineTracker(false);
    expect(legacy.fromJSON(snapshot.entries)).toBe(1); // v1 = bare entry map
    expect(legacy.getBaseline('support_bot', 'v').mean_tokens).toBe(100);

    const corrupt = new RollingBaselineTracker(false);
    expect(
      corrupt.fromJSON({
        schemaVersion: BASELINE_SCHEMA_VERSION,
        entries: {
          'support_bot:x': {
            useCase: 'support_bot',
            queryType: 'x',
            tokens: { count: 'NaN' },
            latency: {},
          },
        },
      }),
    ).toBe(0);
    expect(() => corrupt.fromJSON({ schemaVersion: 99, entries: {} })).toThrow(/newer/);
  });
});
