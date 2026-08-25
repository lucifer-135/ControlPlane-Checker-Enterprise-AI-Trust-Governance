/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  EvaluationResult,
  PolicyProfile,
  SyntheticInteraction,
  UseCaseId,
  VerdictTier,
} from '../types';
import { evaluatePerformanceLane } from './lanes/performanceLane';
import { evaluateCostLane } from './lanes/costLane';
import { evaluateResponsibilityLane } from './lanes/responsibilityLane';

// Global / in-memory session accumulator map: sessionId -> currentRisk (0.0 to 1.0)
export type SessionAccumulatorMap = Record<string, number>;

export function evaluateInteraction(
  interaction: SyntheticInteraction,
  policy: PolicyProfile,
  sessionAccumulator: number = 0
): EvaluationResult {
  // 1. Run the three lanes concurrently
  const performance = evaluatePerformanceLane(
    interaction.prompt,
    interaction.retrieved_context,
    interaction.response,
    interaction.use_case,
    policy.thresholds.hallucination_cutoff
  );

  const cost = evaluateCostLane(
    interaction.token_count,
    interaction.latency_ms,
    interaction.use_case,
    interaction.query_type,
    interaction.tool_calls_count || 0,
    policy.thresholds.cost_z_score_cutoff
  );

  const responsibility = evaluateResponsibilityLane(
    interaction.response,
    policy.geography_ruleset,
    policy.thresholds.pii_severity_cutoff,
    policy.thresholds.toxicity_cutoff
  );

  // 2. Compute Multi-lane overlaps
  const overlappingLanes: string[] = [];
  if (performance.risk_score >= 0.45) {
    overlappingLanes.push(
      performance.is_confidently_wrong ? 'Performance (Confidently Wrong)' : 'Performance (Ungrounded)'
    );
  }
  if (cost.is_outlier) {
    overlappingLanes.push(cost.is_runaway_loop ? 'Cost (Runaway Loop)' : 'Cost (Token/Latency Outlier)');
  }
  if (responsibility.risk_score >= 0.4) {
    if (responsibility.pii_detected.length > 0 && responsibility.bias_flags.length > 0) {
      overlappingLanes.push('Responsibility (PII & Bias)');
    } else if (responsibility.pii_detected.length > 0) {
      overlappingLanes.push('Responsibility (PII Exposure)');
    } else if (responsibility.bias_flags.length > 0) {
      overlappingLanes.push(`Responsibility (${responsibility.bias_flags[0]})`);
    }
  }

  const hasMultiLaneOverlap = overlappingLanes.length >= 2;

  // 3. Normalize active weights
  let totalWeight = 0;
  if (policy.active_lanes.performance) totalWeight += policy.lane_weights.performance;
  if (policy.active_lanes.cost) totalWeight += policy.lane_weights.cost;
  if (policy.active_lanes.responsibility) totalWeight += policy.lane_weights.responsibility;
  if (totalWeight === 0) totalWeight = 1;

  const wPerf = policy.active_lanes.performance ? policy.lane_weights.performance / totalWeight : 0;
  const wCost = policy.active_lanes.cost ? policy.lane_weights.cost / totalWeight : 0;
  const wResp = policy.active_lanes.responsibility ? policy.lane_weights.responsibility / totalWeight : 0;

  const rawComposite =
    performance.risk_score * wPerf +
    cost.risk_score * wCost +
    responsibility.risk_score * wResp;

  const compositeRiskScore = Number(Math.min(1.0, Math.max(0.0, rawComposite)).toFixed(3));

  // 4. Session risk compounding (decaying exponential accumulator)
  // New turn risk compounds previous session turns
  const sessionDecayFactor = 0.45;
  const newSessionRisk = Number(
    Math.min(1.0, compositeRiskScore * 0.7 + sessionAccumulator * sessionDecayFactor).toFixed(3)
  );

  // Effective risk considers both turn and session compounding
  const effectiveRisk = Math.max(compositeRiskScore, newSessionRisk * 0.9);

  // 5. Tier Mapping
  let verdict: VerdictTier = 'ALLOW';
  if (effectiveRisk >= policy.thresholds.block_escalate) {
    verdict = 'BLOCK_ESCALATE';
  } else if (effectiveRisk >= policy.thresholds.soft_correct) {
    verdict = 'SOFT_CORRECT';
  } else if (effectiveRisk >= policy.thresholds.badge) {
    verdict = 'BADGE';
  }

  // Hard governance overrides for non-negotiable compliance risks
  if (
    responsibility.bias_flags.some((b) => b.includes('Redlining') || b.includes('Gender') || b.includes('Xenophobia')) ||
    responsibility.pii_detected.some((p) => p.type === 'SSN' || p.type === 'CREDIT_CARD') ||
    cost.is_runaway_loop
  ) {
    verdict = 'BLOCK_ESCALATE';
  }

  // Added overhead latency simulation (racing the model vs pre-response blocking)
  const baseOverheadMs = policy.pre_response_blocking ? 140 : 35;
  const addedLatency = Math.round(baseOverheadMs + Math.random() * 20);

  return {
    interaction_id: interaction.id,
    use_case: interaction.use_case,
    timestamp: interaction.metadata.created_at || new Date().toISOString(),
    performance,
    cost,
    responsibility,
    composite_risk_score: compositeRiskScore,
    session_accumulated_risk: newSessionRisk,
    verdict,
    has_multi_lane_overlap: hasMultiLaneOverlap,
    overlapping_lanes: overlappingLanes,
    added_overhead_latency_ms: addedLatency,
    is_pre_response_blocked: policy.pre_response_blocking && verdict === 'BLOCK_ESCALATE',
    policy_profile_version: policy.version,
    is_flagged_for_review: verdict === 'BLOCK_ESCALATE',
  };
}

export function evaluateDataset(
  interactions: SyntheticInteraction[],
  policyProfiles: Record<UseCaseId, PolicyProfile>
): {
  evaluations: Record<string, EvaluationResult>;
  sessionAccumulators: SessionAccumulatorMap;
} {
  const evaluations: Record<string, EvaluationResult> = {};
  const sessionAccumulators: SessionAccumulatorMap = {};

  for (const item of interactions) {
    const policy = policyProfiles[item.use_case];
    const prevSessionRisk = sessionAccumulators[item.session_id] || 0;

    const res = evaluateInteraction(item, policy, prevSessionRisk);
    evaluations[item.id] = res;
    sessionAccumulators[item.session_id] = res.session_accumulated_risk;
  }

  return { evaluations, sessionAccumulators };
}
