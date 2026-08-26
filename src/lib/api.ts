/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  EvaluationResult,
  PolicyProfile,
  ReviewDecision,
  SyntheticInteraction,
  UseCaseId,
} from '../types';
import { SYNTHETIC_INTERACTIONS } from '../data/interactions';
import { DEFAULT_POLICY_PROFILES } from './policyProfiles';
import { evaluateDataset } from './decisionEngine';

export async function fetchInteractionsApi(
  useCase?: string,
): Promise<{ interactions: SyntheticInteraction[]; evaluations: Record<string, EvaluationResult> }> {
  try {
    const url = useCase && useCase !== 'ALL' ? `/api/interactions?useCase=${useCase}` : '/api/interactions';
    const resp = await fetch(url);
    if (resp.ok) {
      const data = await resp.json();
      if (data.interactions && data.interactions.length > 0) {
        return data;
      }
    }
  } catch (err) {
    console.warn('[API Client] Backend offline, utilizing in-memory state:', err);
  }

  // Graceful in-memory fallback
  const { evaluations } = evaluateDataset(SYNTHETIC_INTERACTIONS, DEFAULT_POLICY_PROFILES);
  const filtered =
    useCase && useCase !== 'ALL'
      ? SYNTHETIC_INTERACTIONS.filter((i) => i.use_case === useCase)
      : SYNTHETIC_INTERACTIONS;

  return { interactions: filtered, evaluations };
}

export async function createInteractionApi(
  interaction: Partial<SyntheticInteraction>,
): Promise<{ interaction: SyntheticInteraction; evaluation: EvaluationResult } | null> {
  try {
    const resp = await fetch('/api/interactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(interaction),
    });
    if (resp.ok) {
      return await resp.json();
    }
  } catch (err) {
    console.warn('[API Client] Failed to save interaction to database:', err);
  }
  return null;
}

export async function fetchReviewsApi(): Promise<ReviewDecision[]> {
  try {
    const resp = await fetch('/api/reviews');
    if (resp.ok) {
      return await resp.json();
    }
  } catch (err) {
    console.warn('[API Client] Backend offline for review decisions, using local state:', err);
  }
  return [];
}

export async function submitReviewDecisionApi(decision: ReviewDecision): Promise<boolean> {
  try {
    const resp = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(decision),
    });
    return resp.ok;
  } catch (err) {
    console.warn('[API Client] Failed to persist review to DB:', err);
    return false;
  }
}

export async function fetchPoliciesApi(): Promise<Record<UseCaseId, PolicyProfile>> {
  try {
    const resp = await fetch('/api/policies');
    if (resp.ok) {
      const data = await resp.json();
      if (data && Object.keys(data).length > 0) {
        return data;
      }
    }
  } catch (err) {
    console.warn('[API Client] Backend offline for policy profiles, using defaults:', err);
  }
  return DEFAULT_POLICY_PROFILES;
}

export async function savePolicyProfileApi(
  useCase: UseCaseId,
  profile: PolicyProfile,
): Promise<boolean> {
  try {
    const resp = await fetch(`/api/policies/${useCase}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    });
    return resp.ok;
  } catch (err) {
    console.warn('[API Client] Failed to persist policy to DB:', err);
    return false;
  }
}

export async function fetchHealthApi() {
  try {
    const resp = await fetch('/api/health');
    if (resp.ok) {
      return await resp.json();
    }
  } catch {
    return { status: 'offline', database: 'in-memory fallback', hasApiKey: false };
  }
}
