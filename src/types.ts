/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type UseCaseId = 'support_bot' | 'internal_copilot' | 'decision_support';

export type VerdictTier = 'ALLOW' | 'BADGE' | 'SOFT_CORRECT' | 'BLOCK_ESCALATE';

export type GroundTruthLabel =
  'clean' | 'hallucinated' | 'pii_leaking' | 'biased_toxic' | 'cost_outlier' | 'custom_test';

export type GeographyRuleset =
  'EU_AI_ACT_STANDARD' | 'US_HIPAA_FINRA' | 'INDIA_DPDP_ACT' | 'INTERNAL_IP_SECURITY';

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface SyntheticInteraction {
  id: string;
  use_case: UseCaseId;
  session_id: string;
  turn_number: number;
  query_type: string;
  prompt: string;
  retrieved_context: string | null;
  response: string;
  token_count: TokenUsage;
  latency_ms: number;
  tool_calls_count?: number;
  ground_truth_labels: GroundTruthLabel[];
  timestamp?: string;
  metadata: {
    user_role?: string;
    jurisdiction?: string;
    created_at?: string;
    model_name?: string;
  };
}

export interface SpanHighlight {
  text: string;
  type: 'hallucination' | 'pii' | 'bias' | 'cost';
  reason: string;
}

export interface PerformanceLaneResult {
  lane: 'performance';
  groundedness_score: number; // 0.0 to 1.0 (1.0 = highly grounded)
  certainty_score: number; // 0.0 to 1.0
  certainty_support_mismatch: number; // 0.0 to 1.0 (high = "confidently wrong")
  is_confidently_wrong: boolean;
  is_ambiguous: boolean;
  needs_judge_call: boolean;
  risk_score: number; // 0.0 to 1.0 (1.0 = high risk)
  triggering_spans: SpanHighlight[];
  explanation: string;
  judge_evaluation?: {
    isLiveLLM: boolean;
    groundednessScore: number;
    certaintyScore: number;
    certaintySupportMismatch: number;
    verdict: string;
    reasoning: string;
    triggeringSpans: string[];
  };
}

export interface CostLaneResult {
  lane: 'cost';
  token_z_score: number;
  latency_z_score: number;
  combined_z_score: number;
  baseline_mean_tokens: number;
  baseline_mean_latency_ms: number;
  is_outlier: boolean;
  is_runaway_loop: boolean;
  risk_score: number; // 0.0 to 1.0
  explanation: string;
}

export interface DetectedEntity {
  type: 'EMAIL' | 'PHONE' | 'SSN' | 'CREDIT_CARD' | 'NAME' | 'ACCOUNT_NO' | 'IP_ADDRESS';
  text: string;
  span_start?: number;
  span_end?: number;
}

export interface ResponsibilityLaneResult {
  lane: 'responsibility';
  pii_detected: DetectedEntity[];
  pii_score: number; // 0.0 to 1.0
  redacted_response: string;
  toxicity_score: number; // 0.0 to 1.0
  bias_flags: string[];
  policy_violations: string[];
  risk_score: number; // 0.0 to 1.0
  triggering_spans: SpanHighlight[];
  explanation: string;
}

export interface EvaluationResult {
  interaction_id: string;
  use_case: UseCaseId;
  timestamp: string;
  performance: PerformanceLaneResult;
  cost: CostLaneResult;
  responsibility: ResponsibilityLaneResult;
  composite_risk_score: number; // 0.0 to 1.0
  session_accumulated_risk: number; // 0.0 to 1.0
  verdict: VerdictTier;
  has_multi_lane_overlap: boolean;
  overlapping_lanes: string[];
  added_overhead_latency_ms: number;
  is_pre_response_blocked: boolean;
  policy_profile_version: string;
  is_flagged_for_review: boolean;
}

export interface PolicyProfile {
  use_case: UseCaseId;
  name: string;
  description: string;
  geography_ruleset: GeographyRuleset;
  latency_budget_ms: number;
  pre_response_blocking: boolean;
  active_lanes: {
    performance: boolean;
    cost: boolean;
    responsibility: boolean;
  };
  lane_weights: {
    performance: number;
    cost: number;
    responsibility: number;
  };
  thresholds: {
    block_escalate: number; // Default e.g. 0.70
    soft_correct: number; // Default e.g. 0.45
    badge: number; // Default e.g. 0.25
    cost_z_score_cutoff: number; // e.g. 2.0
    pii_severity_cutoff: number; // e.g. 0.3
    hallucination_cutoff: number; // e.g. 0.4
    toxicity_cutoff: number; // e.g. 0.4
  };
  timeout_fallback: 'UNKNOWN_FLAG' | 'PASS' | 'BLOCK';
  version: string;
}

export interface ReviewDecision {
  id: string;
  interaction_id: string;
  reviewed_at: string;
  reviewer: string;
  action: 'CONFIRM_BLOCK' | 'OVERRIDE_ALLOW' | 'EDIT_ALLOW';
  notes: string;
  edited_response?: string;
  original_verdict: VerdictTier;
  new_verdict: VerdictTier;
  primary_trigger_lane: string;
}

export interface ConfusionMatrix {
  true_positives: number;
  false_positives: number;
  true_negatives: number;
  false_negatives: number;
  precision: number;
  recall: number;
  f1_score: number;
  accuracy: number;
  fp_rate: number;
  fn_rate: number;
  total_evaluated: number;
}
