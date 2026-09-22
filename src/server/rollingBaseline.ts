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
 */

import { BASELINE_METRICS, type QueryBaseline } from '../data/baselines.js';
import type { UseCaseId } from '../types.js';

interface WelfordStats {
  count: number;
  mean: number;
  m2: number; // Sum of squared differences from the current mean
}

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
  return {
    count: Math.max(2, seedCount),
    mean: initialMean,
    m2: initialStdDev ** 2 * (seedCount - 1),
  };
}

function updateWelford(stats: WelfordStats, newValue: number): void {
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

export interface BaselineEntry {
  useCase: UseCaseId;
  queryType: string;
  tokens: WelfordStats;
  latency: WelfordStats;
}

export class RollingBaselineTracker {
  private entries: Map<string, BaselineEntry> = new Map();

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
   * Records a new live observation and updates rolling stats in O(1) time and memory.
   */
  public recordObservation(
    useCase: UseCaseId,
    queryType: string,
    totalTokens: number,
    latencyMs: number,
  ): void {
    const key = this.getKey(useCase, queryType);
    let entry = this.entries.get(key);

    if (!entry) {
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

    // Default fallback if unknown queryType
    return {
      use_case: useCase,
      query_type: queryType,
      mean_tokens: 250,
      stddev_tokens: 60,
      mean_latency_ms: 450,
      stddev_latency_ms: 90,
      sample_size: 100,
    };
  }

  /**
   * Exports all current rolling statistics to JSON.
   */
  public toJSON(): Record<string, any> {
    const obj: Record<string, any> = {};
    for (const [key, entry] of this.entries.entries()) {
      obj[key] = {
        useCase: entry.useCase,
        queryType: entry.queryType,
        tokens: entry.tokens,
        latency: entry.latency,
      };
    }
    return obj;
  }

  /**
   * Restores tracker state from JSON.
   */
  public fromJSON(data: Record<string, any>): void {
    for (const [key, entry] of Object.entries(data)) {
      this.entries.set(key, entry as BaselineEntry);
    }
  }
}

// Global singleton instance for the process
export const globalBaselineTracker = new RollingBaselineTracker(true);
