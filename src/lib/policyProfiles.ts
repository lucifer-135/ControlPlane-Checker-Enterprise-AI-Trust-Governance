/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PolicyProfile, UseCaseId } from '../types';

export const DEFAULT_POLICY_PROFILES: Record<UseCaseId, PolicyProfile> = {
  support_bot: {
    use_case: 'support_bot',
    name: 'Customer Support Bot Profile',
    description: 'High-throughput, customer-facing tier. Strict against toxic language and PII disclosures with low added latency.',
    geography_ruleset: 'EU_AI_ACT_STANDARD',
    latency_budget_ms: 180,
    pre_response_blocking: false,
    active_lanes: {
      performance: true,
      cost: true,
      responsibility: true,
    },
    lane_weights: {
      performance: 0.40,
      cost: 0.30,
      responsibility: 0.30,
    },
    thresholds: {
      block_escalate: 0.70,
      soft_correct: 0.45,
      badge: 0.25,
      cost_z_score_cutoff: 2.0,
      pii_severity_cutoff: 0.30,
      hallucination_cutoff: 0.40,
      toxicity_cutoff: 0.40,
    },
    timeout_fallback: 'UNKNOWN_FLAG',
    version: '2.4.1-rc',
  },
  internal_copilot: {
    use_case: 'internal_copilot',
    name: 'Internal Knowledge Copilot Profile',
    description: 'Medium-latency budget. Focused on intellectual property protection, internal executive compensation privacy, and code correctness.',
    geography_ruleset: 'INTERNAL_IP_SECURITY',
    latency_budget_ms: 250,
    pre_response_blocking: false,
    active_lanes: {
      performance: true,
      cost: true,
      responsibility: true,
    },
    lane_weights: {
      performance: 0.45,
      cost: 0.15,
      responsibility: 0.40,
    },
    thresholds: {
      block_escalate: 0.65,
      soft_correct: 0.40,
      badge: 0.20,
      cost_z_score_cutoff: 2.5,
      pii_severity_cutoff: 0.25,
      hallucination_cutoff: 0.40,
      toxicity_cutoff: 0.35,
    },
    timeout_fallback: 'UNKNOWN_FLAG',
    version: '1.9.0',
  },
  decision_support: {
    use_case: 'decision_support',
    name: 'Regulated Decision Support Profile',
    description: 'Highest regulatory scrutiny (FINRA, ECOA, HIPAA). Pre-response blocking enabled for high-risk credit, loan, and insurance triage.',
    geography_ruleset: 'US_HIPAA_FINRA',
    latency_budget_ms: 400,
    pre_response_blocking: true,
    active_lanes: {
      performance: true,
      cost: true,
      responsibility: true,
    },
    lane_weights: {
      performance: 0.50,
      cost: 0.10,
      responsibility: 0.40,
    },
    thresholds: {
      block_escalate: 0.55,
      soft_correct: 0.35,
      badge: 0.18,
      cost_z_score_cutoff: 3.0,
      pii_severity_cutoff: 0.15,
      hallucination_cutoff: 0.30,
      toxicity_cutoff: 0.25,
    },
    timeout_fallback: 'BLOCK',
    version: '3.1.0-strict',
  },
};

export function policyToYaml(profile: PolicyProfile): string {
  return `# ControlPlane Checker Policy Profile
# Generated: ${new Date().toISOString()}
version: "${profile.version}"
use_case: "${profile.use_case}"
name: "${profile.name}"
description: "${profile.description}"
geography_ruleset: "${profile.geography_ruleset}"

runtime_governance:
  latency_budget_ms: ${profile.latency_budget_ms}
  pre_response_blocking: ${profile.pre_response_blocking}
  timeout_fallback: "${profile.timeout_fallback}"

active_lanes:
  performance: ${profile.active_lanes.performance}
  cost: ${profile.active_lanes.cost}
  responsibility: ${profile.active_lanes.responsibility}

lane_weights:
  performance: ${profile.lane_weights.performance.toFixed(2)}
  cost: ${profile.lane_weights.cost.toFixed(2)}
  responsibility: ${profile.lane_weights.responsibility.toFixed(2)}

verdict_tier_thresholds:
  block_escalate: ${profile.thresholds.block_escalate.toFixed(2)}
  soft_correct: ${profile.thresholds.soft_correct.toFixed(2)}
  badge: ${profile.thresholds.badge.toFixed(2)}

lane_cutoffs:
  cost_z_score_cutoff: ${profile.thresholds.cost_z_score_cutoff.toFixed(1)}
  pii_severity_cutoff: ${profile.thresholds.pii_severity_cutoff.toFixed(2)}
  hallucination_cutoff: ${profile.thresholds.hallucination_cutoff.toFixed(2)}
  toxicity_cutoff: ${profile.thresholds.toxicity_cutoff.toFixed(2)}
`;
}
