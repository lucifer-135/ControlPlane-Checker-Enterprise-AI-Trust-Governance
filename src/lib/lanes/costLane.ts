/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CostLaneResult, TokenUsage, UseCaseId } from '../../types';
import { getBaseline } from '../../data/baselines';

export function evaluateCostLane(
  tokenCount: TokenUsage,
  latencyMs: number,
  useCase: UseCaseId,
  queryType: string,
  toolCallsCount: number = 0,
  zScoreCutoff: number = 2.0
): CostLaneResult {
  const baseline = getBaseline(useCase, queryType);

  // Compute Z-scores for total tokens and latency
  const tokenZ = (tokenCount.total - baseline.mean_tokens) / baseline.stddev_tokens;
  const latencyZ = (latencyMs - baseline.mean_latency_ms) / baseline.stddev_latency_ms;

  // Max Z-score drives the outlier determination
  const combinedZ = Math.max(tokenZ, latencyZ);

  const isRunawayLoop = toolCallsCount >= 4 || tokenCount.completion > baseline.mean_tokens * 3.5;
  const isOutlier = combinedZ >= zScoreCutoff || isRunawayLoop;

  // Convert Z-score into normalized risk score [0.0, 1.0]
  // Z <= 0 -> 0 risk; Z = 2 -> 0.6 risk; Z >= 4 -> 1.0 risk
  let riskScore = 0.0;
  if (isRunawayLoop) {
    riskScore = 0.95;
  } else if (combinedZ > 0) {
    riskScore = Math.min(1.0, (combinedZ / 4.0));
  }

  let explanation = `Normal resource consumption (Z-Score: ${combinedZ.toFixed(2)}, Latency: ${latencyMs}ms vs mean ${baseline.mean_latency_ms}ms).`;
  if (isRunawayLoop) {
    explanation = `Critical Runaway Loop Alert: ${toolCallsCount > 0 ? `${toolCallsCount} sequential tool retries` : 'Token explosion'} (${tokenCount.total} tokens, ${latencyMs}ms vs mean ${baseline.mean_tokens} tokens).`;
  } else if (isOutlier) {
    explanation = `Resource Outlier (Z-Score: ${combinedZ.toFixed(2)} > cutoff ${zScoreCutoff}): Token/latency consumption exceeds ${zScoreCutoff} standard deviations from rolling baseline.`;
  }

  return {
    lane: 'cost',
    token_z_score: Number(tokenZ.toFixed(2)),
    latency_z_score: Number(latencyZ.toFixed(2)),
    combined_z_score: Number(combinedZ.toFixed(2)),
    baseline_mean_tokens: baseline.mean_tokens,
    baseline_mean_latency_ms: baseline.mean_latency_ms,
    is_outlier: isOutlier,
    is_runaway_loop: isRunawayLoop,
    risk_score: Number(riskScore.toFixed(3)),
    explanation,
  };
}
