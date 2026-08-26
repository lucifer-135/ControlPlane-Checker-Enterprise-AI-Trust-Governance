/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { SYNTHETIC_INTERACTIONS } from '../data/interactions';
import { DEFAULT_POLICY_PROFILES } from './policyProfiles';
import { evaluateDataset } from './decisionEngine';

describe('evaluateDataset', () => {
  it('evaluates each synthetic interaction against the active policy profiles', () => {
    const { evaluations } = evaluateDataset(SYNTHETIC_INTERACTIONS, DEFAULT_POLICY_PROFILES);

    expect(Object.keys(evaluations)).toHaveLength(SYNTHETIC_INTERACTIONS.length);
    expect(Object.values(evaluations).every((result) => result.verdict)).toBe(true);
  });
});
