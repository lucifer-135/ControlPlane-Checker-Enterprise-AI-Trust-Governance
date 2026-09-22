/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Policy Loader — Policy-as-Code YAML Loader
 *
 * Implements declarative GitOps-compatible policy management:
 * 1. Loads and parses .yaml/.yml policy definitions from disk
 * 2. Maps both standard flat YAML and Kubernetes-style CRD specs into PolicyProfile
 * 3. Hot-reloads on file changes without restarting the gateway
 * 4. Fallback to DEFAULT_POLICY_PROFILES when directory is empty or errors occur
 */

import * as fs from 'fs';
import * as path from 'path';
import { load as yamlLoad } from 'js-yaml';
import { DEFAULT_POLICY_PROFILES, policyToYaml } from '../lib/policyProfiles.js';
import type { PolicyProfile, UseCaseId } from '../types.js';

const DEFAULT_POLICIES_DIR = path.resolve(process.cwd(), 'policies');

/**
 * Parses a raw YAML object (either flat or CRD style) into a valid PolicyProfile.
 */
export function parsePolicyYaml(raw: any): PolicyProfile | null {
  if (!raw || typeof raw !== 'object') return null;

  // Handle Kubernetes-style CRD:
  // apiVersion: governance.controlplane.io/v1alpha1
  // kind: PolicyProfile
  // spec: { ... }
  if (raw.spec && typeof raw.spec === 'object') {
    const spec = raw.spec;
    const meta = raw.metadata || {};
    const useCase = (meta.name || raw.use_case || 'support_bot') as UseCaseId;

    const baseProfile = DEFAULT_POLICY_PROFILES[useCase] || DEFAULT_POLICY_PROFILES.support_bot;

    return {
      use_case: useCase,
      name: meta.title || meta.name || baseProfile.name,
      description: meta.description || baseProfile.description,
      geography_ruleset: spec.jurisdiction || baseProfile.geography_ruleset,
      latency_budget_ms:
        spec.enactment?.max_pipeline_latency_budget_ms || baseProfile.latency_budget_ms,
      pre_response_blocking:
        spec.enactment?.default_mode === 'FAIL_CLOSED' || baseProfile.pre_response_blocking,
      failMode: spec.enactment?.default_mode || 'FAIL_OPEN',
      active_lanes: {
        performance: spec.lanes?.performance !== undefined ? Boolean(spec.lanes.performance) : true,
        cost: spec.lanes?.cost !== undefined ? Boolean(spec.lanes.cost) : true,
        responsibility:
          spec.lanes?.responsibility !== undefined ? Boolean(spec.lanes.responsibility) : true,
      },
      lane_weights: {
        performance: spec.weights?.performance ?? baseProfile.lane_weights.performance,
        cost: spec.weights?.cost ?? baseProfile.lane_weights.cost,
        responsibility: spec.weights?.responsibility ?? baseProfile.lane_weights.responsibility,
      },
      thresholds: {
        block_escalate: spec.thresholds?.block_escalate ?? baseProfile.thresholds.block_escalate,
        soft_correct: spec.thresholds?.soft_correct ?? baseProfile.thresholds.soft_correct,
        badge: spec.thresholds?.badge ?? baseProfile.thresholds.badge,
        cost_z_score_cutoff:
          spec.lanes?.cost?.token_z_score_cutoff ?? baseProfile.thresholds.cost_z_score_cutoff,
        pii_severity_cutoff:
          spec.thresholds?.pii_severity_cutoff ?? baseProfile.thresholds.pii_severity_cutoff,
        hallucination_cutoff: spec.lanes?.performance?.min_groundedness
          ? 1 - spec.lanes.performance.min_groundedness
          : baseProfile.thresholds.hallucination_cutoff,
        toxicity_cutoff: spec.thresholds?.toxicity_cutoff ?? baseProfile.thresholds.toxicity_cutoff,
      },
      timeout_fallback: spec.enactment?.timeout_fallback || baseProfile.timeout_fallback,
      version: meta.version || raw.version || '1.0.0',
    };
  }

  // Handle standard flat YAML (from policyToYaml)
  const useCase = (raw.use_case || 'support_bot') as UseCaseId;
  const base = DEFAULT_POLICY_PROFILES[useCase] || DEFAULT_POLICY_PROFILES.support_bot;

  return {
    use_case: useCase,
    name: raw.name || base.name,
    description: raw.description || base.description,
    geography_ruleset: raw.geography_ruleset || base.geography_ruleset,
    latency_budget_ms:
      raw.runtime_governance?.latency_budget_ms ?? raw.latency_budget_ms ?? base.latency_budget_ms,
    pre_response_blocking:
      raw.runtime_governance?.pre_response_blocking ??
      raw.pre_response_blocking ??
      base.pre_response_blocking,
    failMode: raw.runtime_governance?.fail_mode ?? raw.failMode ?? 'FAIL_OPEN',
    active_lanes: {
      performance: raw.active_lanes?.performance ?? base.active_lanes.performance,
      cost: raw.active_lanes?.cost ?? base.active_lanes.cost,
      responsibility: raw.active_lanes?.responsibility ?? base.active_lanes.responsibility,
    },
    lane_weights: {
      performance: raw.lane_weights?.performance ?? base.lane_weights.performance,
      cost: raw.lane_weights?.cost ?? base.lane_weights.cost,
      responsibility: raw.lane_weights?.responsibility ?? base.lane_weights.responsibility,
    },
    thresholds: {
      block_escalate:
        raw.verdict_tier_thresholds?.block_escalate ??
        raw.thresholds?.block_escalate ??
        base.thresholds.block_escalate,
      soft_correct:
        raw.verdict_tier_thresholds?.soft_correct ??
        raw.thresholds?.soft_correct ??
        base.thresholds.soft_correct,
      badge: raw.verdict_tier_thresholds?.badge ?? raw.thresholds?.badge ?? base.thresholds.badge,
      cost_z_score_cutoff:
        raw.lane_cutoffs?.cost_z_score_cutoff ??
        raw.thresholds?.cost_z_score_cutoff ??
        base.thresholds.cost_z_score_cutoff,
      pii_severity_cutoff:
        raw.lane_cutoffs?.pii_severity_cutoff ??
        raw.thresholds?.pii_severity_cutoff ??
        base.thresholds.pii_severity_cutoff,
      hallucination_cutoff:
        raw.lane_cutoffs?.hallucination_cutoff ??
        raw.thresholds?.hallucination_cutoff ??
        base.thresholds.hallucination_cutoff,
      toxicity_cutoff:
        raw.lane_cutoffs?.toxicity_cutoff ??
        raw.thresholds?.toxicity_cutoff ??
        base.thresholds.toxicity_cutoff,
    },
    timeout_fallback:
      raw.runtime_governance?.timeout_fallback ?? raw.timeout_fallback ?? base.timeout_fallback,
    version: raw.version || base.version,
  };
}

/**
 * Initializes the policies directory with defaults if empty.
 */
export function ensureDefaultPolicyFiles(policiesDir: string = DEFAULT_POLICIES_DIR): void {
  if (!fs.existsSync(policiesDir)) {
    fs.mkdirSync(policiesDir, { recursive: true });
  }

  const existing = fs
    .readdirSync(policiesDir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  if (existing.length === 0) {
    for (const [key, profile] of Object.entries(DEFAULT_POLICY_PROFILES)) {
      const filename = `${key.replace(/_/g, '-')}.yaml`;
      const filePath = path.join(policiesDir, filename);
      fs.writeFileSync(filePath, policyToYaml(profile), 'utf-8');
      console.log(`[PolicyLoader] Created default policy file: ${filename}`);
    }
  }
}

/**
 * Loads all policy profiles from the policies directory.
 */
export function loadPoliciesFromDir(
  policiesDir: string = DEFAULT_POLICIES_DIR,
): Record<string, PolicyProfile> {
  const result: Record<string, PolicyProfile> = { ...DEFAULT_POLICY_PROFILES };

  try {
    ensureDefaultPolicyFiles(policiesDir);

    const files = fs
      .readdirSync(policiesDir)
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
    for (const file of files) {
      const fullPath = path.join(policiesDir, file);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const parsedYaml = yamlLoad(content);
      const profile = parsePolicyYaml(parsedYaml);

      if (profile) {
        result[profile.use_case] = profile;
        console.log(
          `[PolicyLoader] Loaded policy '${profile.use_case}' from ${file} (v${profile.version})`,
        );
      }
    }
  } catch (err) {
    console.warn(
      '[PolicyLoader] Error reading policies directory, falling back to in-memory defaults:',
      err,
    );
  }

  return result;
}

/**
 * Watches the policies directory for changes and invokes callback when modified.
 */
export function watchPoliciesDir(
  policiesDir: string = DEFAULT_POLICIES_DIR,
  onChange: (profiles: Record<string, PolicyProfile>) => void,
): fs.FSWatcher | null {
  if (!fs.existsSync(policiesDir)) {
    try {
      fs.mkdirSync(policiesDir, { recursive: true });
    } catch {
      return null;
    }
  }

  try {
    let debounceTimer: NodeJS.Timeout | null = null;
    const watcher = fs.watch(policiesDir, (eventType, filename) => {
      if (!filename || (!filename.endsWith('.yaml') && !filename.endsWith('.yml'))) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        console.log(`[PolicyLoader] Detected change in ${filename}, reloading policies...`);
        const updated = loadPoliciesFromDir(policiesDir);
        onChange(updated);
      }, 300);
    });

    return watcher;
  } catch (err) {
    console.warn('[PolicyLoader] Could not initialize directory watcher:', err);
    return null;
  }
}
