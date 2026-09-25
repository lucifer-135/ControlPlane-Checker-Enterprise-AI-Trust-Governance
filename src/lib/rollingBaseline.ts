/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Rolling Baseline Tracker — Streaming Welford's Online Algorithm
 *
 * Implements real-time O(1) online mean and variance tracking for:
 * - Token consumption (prompt + completion)
 * - End-to-end request latency (ms)
 *
 * Replaces static hardcoded baselines with dynamically adapting statistics
 * per (use_case, query_type) bucket.
 *
 * Poisoning / drift safeguards:
 * - Observations must be finite, non-negative, and below hard caps.
 * - Use cases must be known and query types must be short identifiers.
 * - Once a bucket is warm, observations are winsorized to mean ± 4σ so a single
 *   outlier cannot drag the baseline.
 * - Each bucket's effective sample size is capped, after which it becomes an
 *   exponentially weighted window (old history decays instead of dominating).
 * - The number of buckets is capped.
 * - State serializes with a schema version so persisted snapshots can be migrated.
 */

import { BASELINE_METRICS, type QueryBaseline } from '../data/baselines.js';
import type { UseCaseId } from '../types.js';

export interface WelfordStats {
  count: number;
  mean: number;
  m2: number; // Sum of squared differences from the current mean
}

export const BASELINE_SCHEMA_VERSION = 2;

const KNOWN_USE_CASES: ReadonlySet<string> = new Set<UseCaseId>([
  'support_bot',
  'internal_copilot',
  'decision_support',
]);
const QUERY_TYPE_PATTERN = /^[a-z0-9_-]{1,64}$/i;
const MAX_TOKENS_OBSERVATION = 1_000_000;
const MAX_LATENCY_OBSERVATION_MS = 10 * 60 * 1000;
/** Effective sample size cap; beyond this the stats behave like an EWMA. */
const MAX_WINDOW = 1000;
/** Observations are only winsorized once a bucket has this many samples. */
const MIN_SAMPLES_FOR_WINSORIZE = 30;
const WINSORIZE_SIGMAS = 4;
const MAX_BUCKETS = 500;

function initEmptyStats(): WelfordStats {
  return {
    count: 0,
    mean: 0,
    m2: 0,
  };
}

function initStats(
  initialMean: number = 0,
  initialStdDev: number = 1,
  seedCount: number = 100,
): WelfordStats {
  const count = Math.min(MAX_WINDOW, Math.max(2, seedCount));
  return {
    count,
    mean: initialMean,
    m2: initialStdDev ** 2 * (count - 1),
  };
}

function updateWelford(stats: WelfordStats, rawValue: number): void {
  let newValue = rawValue;
  if (stats.count >= MIN_SAMPLES_FOR_WINSORIZE) {
    const sd = getStdDev(stats);
    const lo = stats.mean - WINSORIZE_SIGMAS * sd;
    const hi = stats.mean + WINSORIZE_SIGMAS * sd;
    newValue = Math.min(hi, Math.max(lo, newValue));
  }

  if (stats.count >= MAX_WINDOW) {
    // Exponentially weighted update with alpha = 1 / window; count stays capped.
    const alpha = 1 / MAX_WINDOW;
    const delta = newValue - stats.mean;
    const variance = (1 - alpha) * (getVariance(stats) + alpha * delta * delta);
    stats.mean += alpha * delta;
    stats.count = MAX_WINDOW;
    stats.m2 = variance * (stats.count - 1);
    return;
  }

  stats.count += 1;
  const delta = newValue - stats.mean;
  stats.mean += delta / stats.count;
  const delta2 = newValue - stats.mean;
  stats.m2 += delta * delta2;
}

function getVariance(stats: WelfordStats): number {
  if (stats.count < 2) return 1.0;
  return stats.m2 / (stats.count - 1);
}

function getStdDev(stats: WelfordStats): number {
  return Math.sqrt(Math.max(0.01, getVariance(stats)));
}

function isValidStats(value: any): value is WelfordStats {
  return (
    !!value &&
    typeof value === 'object' &&
    [value.count, value.mean, value.m2].every(
      (n: unknown) => typeof n === 'number' && Number.isFinite(n),
    ) &&
    value.count >= 0 &&
    value.m2 >= 0
  );
}

/** Caps the sample count at MAX_WINDOW while preserving the variance. */
function clampToWindow(stats: WelfordStats): WelfordStats {
  if (stats.count <= MAX_WINDOW) return { ...stats };
  return { count: MAX_WINDOW, mean: stats.mean, m2: getVariance(stats) * (MAX_WINDOW - 1) };
}

export class InvalidObservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidObservationError';
  }
}

/** Returns a reason string when the observation must be rejected, else null. */
export function validateObservation(
  useCase: unknown,
  queryType: unknown,
  totalTokens: unknown,
  latencyMs: unknown,
): string | null {
  if (typeof useCase !== 'string' || !KNOWN_USE_CASES.has(useCase)) {
    return `Unknown use case: ${String(useCase)}`;
  }
  if (typeof queryType !== 'string' || !QUERY_TYPE_PATTERN.test(queryType)) {
    return 'queryType must be 1-64 characters of [A-Za-z0-9_-]';
  }
  if (typeof totalTokens !== 'number' || !Number.isFinite(totalTokens) || totalTokens < 0) {
    return 'totalTokens must be a finite, non-negative number';
  }
  if (typeof latencyMs !== 'number' || !Number.isFinite(latencyMs) || latencyMs < 0) {
    return 'latencyMs must be a finite, non-negative number';
  }
  if (totalTokens > MAX_TOKENS_OBSERVATION) {
    return `totalTokens exceeds ${MAX_TOKENS_OBSERVATION}`;
  }
  if (latencyMs > MAX_LATENCY_OBSERVATION_MS) {
    return `latencyMs exceeds ${MAX_LATENCY_OBSERVATION_MS}`;
  }
  return null;
}

export interface BaselineEntry {
  useCase: UseCaseId;
  queryType: string;
  tokens: WelfordStats;
  latency: WelfordStats;
}

export interface BaselineSnapshot {
  schemaVersion: number;
  entries: Record<string, BaselineEntry>;
}

export class RollingBaselineTracker {
  private entries: Map<string, BaselineEntry> = new Map();
  private dirty = false;

  constructor(seedFromDefaults: boolean = true) {
    if (seedFromDefaults) {
      this.seedFromDefaultBaselines();
    }
  }

  /**
   * Pre-populates the tracker with existing static baselines as prior observations.
   */
  private seedFromDefaultBaselines(): void {
    for (const [key, b] of Object.entries(BASELINE_METRICS)) {
      this.entries.set(key, {
        useCase: b.use_case,
        queryType: b.query_type,
        tokens: initStats(b.mean_tokens, b.stddev_tokens, b.sample_size),
        latency: initStats(b.mean_latency_ms, b.stddev_latency_ms, b.sample_size),
      });
    }
  }

  private getKey(useCase: UseCaseId, queryType: string): string {
    return `${useCase}:${queryType}`;
  }

  /**
   * Resets the tracker entries, optionally re-seeding from default baselines.
   */
  public reset(seedFromDefaults: boolean = true): void {
    this.entries.clear();
    if (seedFromDefaults) {
      this.seedFromDefaultBaselines();
    }
    this.dirty = true;
  }

  /** True when state changed since the last `markClean()` (used for persistence). */
  public isDirty(): boolean {
    return this.dirty;
  }

  public markClean(): void {
    this.dirty = false;
  }

  /**
   * Records a new live observation and updates rolling stats in O(1) time and memory.
   * Callers must only pass observations from trusted traffic (e.g. requests that
   * were scored ALLOW), and must score a request BEFORE recording it.
   *
   * @throws InvalidObservationError when the observation fails validation.
   */
  public recordObservation(
    useCase: UseCaseId,
    queryType: string,
    totalTokens: number,
    latencyMs: number,
  ): void {
    const invalid = validateObservation(useCase, queryType, totalTokens, latencyMs);
    if (invalid) {
      throw new InvalidObservationError(invalid);
    }

    const key = this.getKey(useCase, queryType);
    let entry = this.entries.get(key);

    if (!entry) {
      if (this.entries.size >= MAX_BUCKETS) {
        throw new InvalidObservationError(`Baseline bucket limit (${MAX_BUCKETS}) reached`);
      }
      entry = {
        useCase,
        queryType,
        tokens: initEmptyStats(),
        latency: initEmptyStats(),
      };
      this.entries.set(key, entry);
    }

    updateWelford(entry.tokens, totalTokens);
    updateWelford(entry.latency, latencyMs);
    this.dirty = true;
  }

  /**
   * Retrieves the current rolling baseline for a use case and query type.
   */
  public getBaseline(useCase: UseCaseId, queryType: string): QueryBaseline {
    const key = this.getKey(useCase, queryType);
    const entry = this.entries.get(key);

    if (entry && entry.tokens.count > 0) {
      return {
        use_case: useCase,
        query_type: queryType,
        mean_tokens: Math.round(entry.tokens.mean),
        stddev_tokens: Math.max(1, Math.round(getStdDev(entry.tokens))),
        mean_latency_ms: Math.round(entry.latency.mean),
        stddev_latency_ms: Math.max(1, Math.round(getStdDev(entry.latency))),
        sample_size: entry.tokens.count,
      };
    }

    // Unknown workload: placeholder values only. sample_size 0 tells the cost
    // lane there is no real baseline yet, so it does not Z-score against it.
    return {
      use_case: useCase,
      query_type: queryType,
      mean_tokens: 250,
      stddev_tokens: 60,
      mean_latency_ms: 450,
      stddev_latency_ms: 90,
      sample_size: entry ? entry.tokens.count : 0,
    };
  }

  /**
   * Exports all current rolling statistics as a versioned snapshot.
   */
  public toJSON(): BaselineSnapshot {
    const entries: Record<string, BaselineEntry> = {};
    for (const [key, entry] of this.entries.entries()) {
      entries[key] = {
        useCase: entry.useCase,
        queryType: entry.queryType,
        tokens: { ...entry.tokens },
        latency: { ...entry.latency },
      };
    }
    return { schemaVersion: BASELINE_SCHEMA_VERSION, entries };
  }

  /**
   * Restores tracker state from a snapshot. Accepts the current versioned format
   * and the legacy (v1) unversioned map. Invalid entries are skipped.
   * Returns the number of entries restored.
   */
  public fromJSON(data: Record<string, any>): number {
    if (!data || typeof data !== 'object') return 0;
    let source: Record<string, any>;
    if (typeof data.schemaVersion === 'number') {
      if (data.schemaVersion > BASELINE_SCHEMA_VERSION) {
        throw new Error(
          `Baseline snapshot schema v${data.schemaVersion} is newer than supported v${BASELINE_SCHEMA_VERSION}`,
        );
      }
      source = data.entries || {};
    } else {
      source = data; // v1: unversioned map of entries
    }

    let restored = 0;
    for (const [key, entry] of Object.entries(source)) {
      if (
        entry &&
        KNOWN_USE_CASES.has(entry.useCase) &&
        typeof entry.queryType === 'string' &&
        key === this.getKey(entry.useCase, entry.queryType) &&
        isValidStats(entry.tokens) &&
        isValidStats(entry.latency) &&
        (this.entries.has(key) || this.entries.size < MAX_BUCKETS)
      ) {
        this.entries.set(key, {
          useCase: entry.useCase,
          queryType: entry.queryType,
          tokens: clampToWindow(entry.tokens),
          latency: clampToWindow(entry.latency),
        });
        restored++;
      }
    }
    if (restored > 0) this.dirty = true;
    return restored;
  }
}

// Global singleton instance for the application lifecycle
export const globalBaselineTracker = new RollingBaselineTracker(true);

/**
 * Resets the global baseline tracker back to seeded default metrics.
 */
export function resetGlobalBaselineTracker(): void {
  globalBaselineTracker.reset(true);
}
