/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  EvaluationResult,
  PolicyProfile,
  SessionEvent,
  SessionState,
  SyntheticInteraction,
  UseCaseId,
  VerdictTier,
} from '../types';
import { evaluatePerformanceLane } from './lanes/performanceLane';
import { evaluateCostLane } from './lanes/costLane';
import { evaluateResponsibilityLane } from './lanes/responsibilityLane';
import type { QueryBaseline } from '../data/baselines';

// ──────────────────────────────────────────────────────────────────────
// Session state accumulator types
// ──────────────────────────────────────────────────────────────────────

/** Map of session ID → full session state with event history for decay. */
export type SessionAccumulatorMap = Record<string, SessionState>;

// ──────────────────────────────────────────────────────────────────────
// Exponential Time-Decay Session Risk Compounding
// ──────────────────────────────────────────────────────────────────────

/**
 * Computes the session-accumulated risk using an exponential time-decay
 * half-life model:
 *
 *   R_session(t) = R_t + Σ R_k * e^(-λ * (T_t - T_k))
 *
 * Where:
 *   λ = ln(2) / t_half
 *   t_half = configurable half-life in turns (default: 5)
 *
 * This means:
 * - A minor probe 5 turns ago contributes only 50% of its original risk.
 * - A minor probe 10 turns ago contributes only 25%.
 * - But if a user triggers repeated boundary probes in rapid succession
 *   ("salami slicing" / "crescendo" jailbreak), the accumulator spikes
 *   and triggers automatic escalation.
 *
 * @param currentTurnRisk   The composite risk score for the current turn.
 * @param currentTurnNumber The turn number within this session.
 * @param sessionState      Previous session state with event history.
 * @param halfLifeTurns     Number of turns for risk to decay by 50% (default: 5).
 * @returns The new session-accumulated risk score in [0, 1].
 */
function computeSessionRisk(
  currentTurnRisk: number,
  currentTurnNumber: number,
  sessionState: SessionState,
  halfLifeTurns: number = 5,
): number {
  const lambda = Math.LN2 / halfLifeTurns;

  let accumulated = 0;
  const events = sessionState && Array.isArray(sessionState.events) ? sessionState.events : [];
  for (const event of events) {
    const turnDelta = currentTurnNumber - event.turnNumber;
    const decay = Math.exp(-lambda * turnDelta);
    accumulated += event.risk * decay;
  }

  return Math.min(1.0, currentTurnRisk + accumulated);
}

// ──────────────────────────────────────────────────────────────────────
// Core Interaction Evaluator
// ──────────────────────────────────────────────────────────────────────

export function evaluateInteraction(
  interaction: SyntheticInteraction,
  policy: PolicyProfile,
  sessionStateInput: SessionState | number = { events: [], currentRisk: 0 },
  baselineGetter?: (useCase: UseCaseId, queryType: string) => QueryBaseline,
): EvaluationResult {
  const sessionState: SessionState =
    typeof sessionStateInput === 'number'
      ? {
          events:
            sessionStateInput > 0
              ? [
                  {
                    risk: sessionStateInput,
                    turnNumber: 0,
                    timestamp: Date.now(),
                  },
                ]
              : [],
          currentRisk: sessionStateInput,
        }
      : sessionStateInput && Array.isArray(sessionStateInput.events)
        ? sessionStateInput
        : { events: [], currentRisk: 0 };

  // Measure actual evaluation overhead
  const evalStart = typeof performance !== 'undefined' ? performance.now() : Date.now();

  // 1. Run the three lanes
  const performanceResult = evaluatePerformanceLane(
    interaction.prompt,
    interaction.retrieved_context,
    interaction.response,
    interaction.use_case,
    policy.thresholds.hallucination_cutoff,
  );

  const cost = evaluateCostLane(
    interaction.token_count,
    interaction.latency_ms,
    interaction.use_case,
    interaction.query_type,
    interaction.tool_calls_count || 0,
    policy.thresholds.cost_z_score_cutoff,
    baselineGetter,
  );

  const responsibility = evaluateResponsibilityLane(
    interaction.response,
    policy.geography_ruleset,
    policy.thresholds.pii_severity_cutoff,
    policy.thresholds.toxicity_cutoff,
  );

  // 2. Compute Multi-lane overlaps
  const overlappingLanes: string[] = [];
  if (performanceResult.risk_score >= 0.45) {
    overlappingLanes.push(
      performanceResult.is_confidently_wrong
        ? 'Performance (Confidently Wrong)'
        : 'Performance (Ungrounded)',
    );
  }
  if (cost.is_outlier) {
    overlappingLanes.push(
      cost.is_runaway_loop ? 'Cost (Runaway Loop)' : 'Cost (Token/Latency Outlier)',
    );
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
  const wResp = policy.active_lanes.responsibility
    ? policy.lane_weights.responsibility / totalWeight
    : 0;

  const rawComposite =
    performanceResult.risk_score * wPerf +
    cost.risk_score * wCost +
    responsibility.risk_score * wResp;

  const compositeRiskScore = Number(Math.min(1.0, Math.max(0.0, rawComposite)).toFixed(3));

  // 4. Session risk compounding (exponential time-decay accumulator)
  const newSessionRisk = Number(
    computeSessionRisk(
      compositeRiskScore,
      interaction.turn_number,
      sessionState,
      5, // half-life of 5 turns
    ).toFixed(3),
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
    responsibility.bias_flags.some(
      (b) => b.includes('Redlining') || b.includes('Gender') || b.includes('Xenophobia'),
    ) ||
    responsibility.pii_detected.some((p) => p.type === 'SSN' || p.type === 'CREDIT_CARD') ||
    cost.is_runaway_loop
  ) {
    verdict = 'BLOCK_ESCALATE';
  }

  // Measure actual added overhead
  const evalEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const addedLatency = Math.round(evalEnd - evalStart);

  return {
    interaction_id: interaction.id,
    use_case: interaction.use_case,
    timestamp: interaction.metadata.created_at || new Date().toISOString(),
    performance: performanceResult,
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

// ──────────────────────────────────────────────────────────────────────
// Batch Dataset Evaluator
// ──────────────────────────────────────────────────────────────────────

export function evaluateDataset(
  interactions: SyntheticInteraction[],
  policyProfiles: Record<UseCaseId, PolicyProfile>,
  baselineGetter?: (useCase: UseCaseId, queryType: string) => QueryBaseline,
): {
  evaluations: Record<string, EvaluationResult>;
  sessionAccumulators: SessionAccumulatorMap;
} {
  const evaluations: Record<string, EvaluationResult> = {};
  const sessionAccumulators: SessionAccumulatorMap = {};

  for (const item of interactions) {
    const policy = policyProfiles[item.use_case];

    // Get or initialize session state
    if (!sessionAccumulators[item.session_id]) {
      sessionAccumulators[item.session_id] = { events: [], currentRisk: 0 };
    }
    const sessionState = sessionAccumulators[item.session_id];

    const res = evaluateInteraction(item, policy, sessionState, baselineGetter);
    evaluations[item.id] = res;

    // Update session state with this turn's risk event
    sessionState.events.push({
      risk: res.composite_risk_score,
      turnNumber: item.turn_number,
      timestamp: Date.now(),
    });
    sessionState.currentRisk = res.session_accumulated_risk;
  }

  return { evaluations, sessionAccumulators };
}
