/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Durable storage for the global rolling baseline tracker.
 *
 * The tracker lives in memory for O(1) scoring; this module restores it from
 * SQLite at startup and flushes it back whenever it has changed.
 */

import { globalBaselineTracker, BASELINE_SCHEMA_VERSION } from '../lib/rollingBaseline.js';
import { loadBaselineState, saveBaselineState } from './db/database.js';

/** Restores the tracker from the last saved snapshot. Returns entries restored. */
export function restoreBaselineState(): number {
  try {
    const saved = loadBaselineState();
    if (!saved) return 0;
    const restored = globalBaselineTracker.fromJSON(JSON.parse(saved.stateJson));
    globalBaselineTracker.markClean();
    console.log(
      `[Baselines] Restored ${restored} rolling baseline buckets (snapshot schema v${saved.schemaVersion})`,
    );
    return restored;
  } catch (err) {
    console.warn('[Baselines] Could not restore baseline snapshot; using seeded defaults:', err);
    return 0;
  }
}

/** Saves the tracker if it changed since the last save. */
export function flushBaselineState(force = false): void {
  if (!force && !globalBaselineTracker.isDirty()) return;
  try {
    saveBaselineState(BASELINE_SCHEMA_VERSION, JSON.stringify(globalBaselineTracker.toJSON()));
    globalBaselineTracker.markClean();
  } catch (err) {
    console.warn('[Baselines] Failed to persist baseline snapshot:', err);
  }
}

/** Periodically flushes dirty baseline state. Returns a stop function. */
export function startBaselinePersistence(intervalMs = 30_000): () => void {
  const timer = setInterval(() => flushBaselineState(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
