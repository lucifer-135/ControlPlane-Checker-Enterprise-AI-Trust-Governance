/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parsePolicyYaml,
  loadPoliciesFromDir,
  writePolicyToFile,
  DuplicatePolicyError,
} from './policyLoader.js';
import { DEFAULT_POLICY_PROFILES } from '../lib/policyProfiles.js';

describe('PolicyLoader', () => {
  it('correctly parses Kubernetes-style CRD PolicyProfile spec', () => {
    const rawCrd = {
      apiVersion: 'governance.controlplane.io/v1alpha1',
      kind: 'PolicyProfile',
      metadata: {
        name: 'support_bot',
        title: 'Customer Support Strict',
        version: '3.0.0',
      },
      spec: {
        jurisdiction: 'EU_AI_ACT_STANDARD',
        enactment: {
          default_mode: 'FAIL_CLOSED',
          max_pipeline_latency_budget_ms: 220,
        },
        lanes: {
          performance: { min_groundedness: 0.75 },
          cost: { token_z_score_cutoff: 2.2 },
          responsibility: { pii_severity_cutoff: 0.2 },
        },
        weights: {
          performance: 0.5,
          cost: 0.2,
          responsibility: 0.3,
        },
        thresholds: {
          block_escalate: 0.65,
          soft_correct: 0.4,
          badge: 0.2,
        },
      },
    };

    const profile = parsePolicyYaml(rawCrd);
    expect(profile).not.toBeNull();
    expect(profile?.use_case).toBe('support_bot');
    expect(profile?.name).toBe('Customer Support Strict');
    expect(profile?.version).toBe('3.0.0');
    expect(profile?.failMode).toBe('FAIL_CLOSED');
    expect(profile?.pre_response_blocking).toBe(true);
    expect(profile?.latency_budget_ms).toBe(220);
    expect(profile?.lane_weights.performance).toBe(0.5);
    expect(profile?.thresholds.block_escalate).toBe(0.65);
  });

  it('correctly parses flat YAML structure', () => {
    const rawFlat = {
      use_case: 'internal_copilot',
      name: 'Internal Dev Profile',
      version: '1.2.0',
      geography_ruleset: 'INTERNAL_IP_SECURITY',
      latency_budget_ms: 300,
      pre_response_blocking: false,
      active_lanes: { performance: true, cost: true, responsibility: true },
      lane_weights: { performance: 0.4, cost: 0.3, responsibility: 0.3 },
      thresholds: { block_escalate: 0.7, soft_correct: 0.45, badge: 0.25 },
    };

    const profile = parsePolicyYaml(rawFlat);
    expect(profile).not.toBeNull();
    expect(profile?.use_case).toBe('internal_copilot');
    expect(profile?.name).toBe('Internal Dev Profile');
    expect(profile?.version).toBe('1.2.0');
  });

  it('returns null for empty or invalid input', () => {
    expect(parsePolicyYaml(null)).toBeNull();
    expect(parsePolicyYaml('')).toBeNull();
    expect(parsePolicyYaml(undefined)).toBeNull();
  });
});

describe('PolicyLoader directory handling', () => {
  function withTempDir(fn: (dir: string) => void) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-policy-loader-'));
    try {
      fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('rejects two files defining the same use_case, naming both files', () => {
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, 'b-support.yaml'), 'use_case: support_bot\nversion: "b"\n');
      fs.writeFileSync(
        path.join(dir, 'a-support.yaml'),
        'apiVersion: governance.controlplane.io/v1alpha1\nkind: PolicyProfile\nmetadata:\n  name: support_bot\nspec: {}\n',
      );
      try {
        loadPoliciesFromDir(dir);
        expect.unreachable('expected DuplicatePolicyError');
      } catch (err) {
        expect(err).toBeInstanceOf(DuplicatePolicyError);
        expect((err as DuplicatePolicyError).files).toEqual(['a-support.yaml', 'b-support.yaml']);
      }
    });
  });

  it('writes edits back to the file that already defines the use_case', () => {
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, 'custom-name.yaml'), 'use_case: support_bot\n');
      writePolicyToFile(
        {
          ...DEFAULT_POLICY_PROFILES.support_bot,
          failMode: 'FAIL_CLOSED',
          thresholds: { ...DEFAULT_POLICY_PROFILES.support_bot.thresholds, block_escalate: 0.33 },
        },
        dir,
      );
      expect(fs.existsSync(path.join(dir, 'support-bot.yaml'))).toBe(false);

      const reloaded = loadPoliciesFromDir(dir);
      expect(reloaded.support_bot.thresholds.block_escalate).toBe(0.33);
      // fail mode round-trips through the flat YAML format
      expect(reloaded.support_bot.failMode).toBe('FAIL_CLOSED');
    });
  });

  it('keeps exactly one policy file per use case in the repository', () => {
    const repoPolicies = path.resolve(process.cwd(), 'policies');
    expect(() => loadPoliciesFromDir(repoPolicies)).not.toThrow();
  });
});
