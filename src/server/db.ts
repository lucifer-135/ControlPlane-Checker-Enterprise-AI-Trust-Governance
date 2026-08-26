/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createClient, Client } from '@libsql/client';
import fs from 'fs';
import path from 'path';
import {
  EvaluationResult,
  PolicyProfile,
  ReviewDecision,
  SyntheticInteraction,
  UseCaseId,
} from '../types';
import { SYNTHETIC_INTERACTIONS } from '../data/interactions';
import { DEFAULT_POLICY_PROFILES } from '../lib/policyProfiles';
import { evaluateInteraction } from '../lib/decisionEngine';

let dbClient: Client | null = null;

export function getDb(customUrl?: string): Client {
  if (!dbClient || customUrl) {
    const dbDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const dbPath = customUrl || process.env.DATABASE_URL || `file:${path.join(dbDir, 'controlplane.db')}`;
    dbClient = createClient({ url: dbPath });
  }
  return dbClient;
}

export async function initDb(client: Client = getDb()): Promise<void> {
  // 1. Telemetry / Interactions Table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS interactions (
      id TEXT PRIMARY KEY,
      use_case TEXT NOT NULL,
      session_id TEXT NOT NULL,
      turn_number INTEGER NOT NULL,
      query_type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      retrieved_context TEXT,
      response TEXT NOT NULL,
      token_prompt INTEGER NOT NULL,
      token_completion INTEGER NOT NULL,
      token_total INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL,
      tool_calls_count INTEGER DEFAULT 0,
      ground_truth_labels TEXT NOT NULL,
      metadata TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // 2. Audit Evaluations Ledger Table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS evaluations (
      interaction_id TEXT PRIMARY KEY,
      use_case TEXT NOT NULL,
      composite_risk_score REAL NOT NULL,
      session_accumulated_risk REAL NOT NULL,
      verdict TEXT NOT NULL,
      has_multi_lane_overlap INTEGER NOT NULL,
      overlapping_lanes TEXT NOT NULL,
      added_overhead_latency_ms INTEGER NOT NULL,
      is_pre_response_blocked INTEGER NOT NULL,
      is_flagged_for_review INTEGER NOT NULL,
      policy_profile_version TEXT NOT NULL,
      performance_result TEXT NOT NULL,
      cost_result TEXT NOT NULL,
      responsibility_result TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      FOREIGN KEY(interaction_id) REFERENCES interactions(id) ON DELETE CASCADE
    );
  `);

  // 3. Human-in-the-Loop Review Queue Adjudications
  await client.execute(`
    CREATE TABLE IF NOT EXISTS review_decisions (
      id TEXT PRIMARY KEY,
      interaction_id TEXT NOT NULL,
      reviewer TEXT NOT NULL,
      action TEXT NOT NULL,
      notes TEXT,
      edited_response TEXT,
      original_verdict TEXT NOT NULL,
      new_verdict TEXT NOT NULL,
      primary_trigger_lane TEXT NOT NULL,
      reviewed_at TEXT NOT NULL,
      FOREIGN KEY(interaction_id) REFERENCES interactions(id) ON DELETE CASCADE
    );
  `);

  // 4. Stored Governance Policy Profiles
  await client.execute(`
    CREATE TABLE IF NOT EXISTS policy_profiles (
      use_case TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Create indexes for query performance
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_interactions_use_case ON interactions(use_case);
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_evaluations_verdict ON evaluations(verdict);
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_reviews_interaction ON review_decisions(interaction_id);
  `);
}

export async function seedIfEmpty(client: Client = getDb()): Promise<{ seeded: boolean; count: number }> {
  await initDb(client);

  const check = await client.execute('SELECT COUNT(*) as count FROM interactions');
  const count = Number(check.rows[0]?.count ?? 0);

  if (count > 0) {
    return { seeded: false, count };
  }

  // 1. Seed Policy Profiles
  for (const [useCase, profile] of Object.entries(DEFAULT_POLICY_PROFILES)) {
    await client.execute({
      sql: `INSERT OR REPLACE INTO policy_profiles (use_case, name, config_json, updated_at) VALUES (?, ?, ?, ?)`,
      args: [useCase, profile.name, JSON.stringify(profile), new Date().toISOString()],
    });
  }

  // 2. Seed Interactions & Evaluations
  const sessionAccumulators: Record<string, number> = {};

  for (const item of SYNTHETIC_INTERACTIONS) {
    // Insert interaction
    await client.execute({
      sql: `INSERT INTO interactions (
        id, use_case, session_id, turn_number, query_type, prompt, retrieved_context,
        response, token_prompt, token_completion, token_total, latency_ms,
        tool_calls_count, ground_truth_labels, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        item.id,
        item.use_case,
        item.session_id,
        item.turn_number,
        item.query_type,
        item.prompt,
        item.retrieved_context,
        item.response,
        item.token_count.prompt,
        item.token_count.completion,
        item.token_count.total,
        item.latency_ms,
        item.tool_calls_count || 0,
        JSON.stringify(item.ground_truth_labels),
        JSON.stringify(item.metadata),
        item.metadata.created_at || new Date().toISOString(),
      ],
    });

    // Evaluate against default policy
    const policy = DEFAULT_POLICY_PROFILES[item.use_case];
    const prevSessionRisk = sessionAccumulators[item.session_id] || 0;
    const evaluation = evaluateInteraction(item, policy, prevSessionRisk);
    sessionAccumulators[item.session_id] = evaluation.session_accumulated_risk;

    // Insert evaluation
    await client.execute({
      sql: `INSERT INTO evaluations (
        interaction_id, use_case, composite_risk_score, session_accumulated_risk,
        verdict, has_multi_lane_overlap, overlapping_lanes, added_overhead_latency_ms,
        is_pre_response_blocked, is_flagged_for_review, policy_profile_version,
        performance_result, cost_result, responsibility_result, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        evaluation.interaction_id,
        evaluation.use_case,
        evaluation.composite_risk_score,
        evaluation.session_accumulated_risk,
        evaluation.verdict,
        evaluation.has_multi_lane_overlap ? 1 : 0,
        JSON.stringify(evaluation.overlapping_lanes),
        evaluation.added_overhead_latency_ms,
        evaluation.is_pre_response_blocked ? 1 : 0,
        evaluation.is_flagged_for_review ? 1 : 0,
        evaluation.policy_profile_version,
        JSON.stringify(evaluation.performance),
        JSON.stringify(evaluation.cost),
        JSON.stringify(evaluation.responsibility),
        evaluation.timestamp,
      ],
    });
  }

  return { seeded: true, count: SYNTHETIC_INTERACTIONS.length };
}

export async function getAllInteractions(
  client: Client = getDb(),
  filterUseCase?: string,
): Promise<{ interactions: SyntheticInteraction[]; evaluations: Record<string, EvaluationResult> }> {
  let query = `
    SELECT i.*, e.composite_risk_score, e.session_accumulated_risk, e.verdict,
           e.has_multi_lane_overlap, e.overlapping_lanes, e.added_overhead_latency_ms,
           e.is_pre_response_blocked, e.is_flagged_for_review, e.policy_profile_version,
           e.performance_result, e.cost_result, e.responsibility_result, e.timestamp as eval_timestamp
    FROM interactions i
    LEFT JOIN evaluations e ON i.id = e.interaction_id
  `;
  const args: any[] = [];

  if (filterUseCase && filterUseCase !== 'ALL') {
    query += ' WHERE i.use_case = ?';
    args.push(filterUseCase);
  }

  query += ' ORDER BY i.created_at ASC';

  const res = await client.execute({ sql: query, args });

  const interactions: SyntheticInteraction[] = [];
  const evaluations: Record<string, EvaluationResult> = {};

  for (const row of res.rows) {
    const id = String(row.id);
    const interaction: SyntheticInteraction = {
      id,
      use_case: row.use_case as UseCaseId,
      session_id: String(row.session_id),
      turn_number: Number(row.turn_number),
      query_type: String(row.query_type),
      prompt: String(row.prompt),
      retrieved_context: row.retrieved_context ? String(row.retrieved_context) : null,
      response: String(row.response),
      token_count: {
        prompt: Number(row.token_prompt),
        completion: Number(row.token_completion),
        total: Number(row.token_total),
      },
      latency_ms: Number(row.latency_ms),
      tool_calls_count: Number(row.tool_calls_count || 0),
      ground_truth_labels: JSON.parse(String(row.ground_truth_labels || '[]')),
      metadata: JSON.parse(String(row.metadata || '{}')),
    };
    interactions.push(interaction);

    if (row.composite_risk_score !== null && row.composite_risk_score !== undefined) {
      evaluations[id] = {
        interaction_id: id,
        use_case: row.use_case as UseCaseId,
        timestamp: String(row.eval_timestamp || row.created_at),
        composite_risk_score: Number(row.composite_risk_score),
        session_accumulated_risk: Number(row.session_accumulated_risk),
        verdict: String(row.verdict) as any,
        has_multi_lane_overlap: Boolean(row.has_multi_lane_overlap),
        overlapping_lanes: JSON.parse(String(row.overlapping_lanes || '[]')),
        added_overhead_latency_ms: Number(row.added_overhead_latency_ms),
        is_pre_response_blocked: Boolean(row.is_pre_response_blocked),
        is_flagged_for_review: Boolean(row.is_flagged_for_review),
        policy_profile_version: String(row.policy_profile_version),
        performance: JSON.parse(String(row.performance_result || '{}')),
        cost: JSON.parse(String(row.cost_result || '{}')),
        responsibility: JSON.parse(String(row.responsibility_result || '{}')),
      };
    }
  }

  return { interactions, evaluations };
}

export async function insertInteractionWithEvaluation(
  interaction: SyntheticInteraction,
  policy: PolicyProfile,
  client: Client = getDb(),
): Promise<EvaluationResult> {
  // Get latest session accumulated risk from DB
  const prevRows = await client.execute({
    sql: `SELECT session_accumulated_risk FROM evaluations WHERE interaction_id IN (
      SELECT id FROM interactions WHERE session_id = ? ORDER BY created_at DESC LIMIT 1
    )`,
    args: [interaction.session_id],
  });

  const prevSessionRisk = Number(prevRows.rows[0]?.session_accumulated_risk ?? 0);
  const evaluation = evaluateInteraction(interaction, policy, prevSessionRisk);

  await client.execute({
    sql: `INSERT OR REPLACE INTO interactions (
      id, use_case, session_id, turn_number, query_type, prompt, retrieved_context,
      response, token_prompt, token_completion, token_total, latency_ms,
      tool_calls_count, ground_truth_labels, metadata, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      interaction.id,
      interaction.use_case,
      interaction.session_id,
      interaction.turn_number,
      interaction.query_type,
      interaction.prompt,
      interaction.retrieved_context,
      interaction.response,
      interaction.token_count.prompt,
      interaction.token_count.completion,
      interaction.token_count.total,
      interaction.latency_ms,
      interaction.tool_calls_count || 0,
      JSON.stringify(interaction.ground_truth_labels || ['custom_test']),
      JSON.stringify(interaction.metadata || {}),
      interaction.metadata?.created_at || new Date().toISOString(),
    ],
  });

  await client.execute({
    sql: `INSERT OR REPLACE INTO evaluations (
      interaction_id, use_case, composite_risk_score, session_accumulated_risk,
      verdict, has_multi_lane_overlap, overlapping_lanes, added_overhead_latency_ms,
      is_pre_response_blocked, is_flagged_for_review, policy_profile_version,
      performance_result, cost_result, responsibility_result, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      evaluation.interaction_id,
      evaluation.use_case,
      evaluation.composite_risk_score,
      evaluation.session_accumulated_risk,
      evaluation.verdict,
      evaluation.has_multi_lane_overlap ? 1 : 0,
      JSON.stringify(evaluation.overlapping_lanes),
      evaluation.added_overhead_latency_ms,
      evaluation.is_pre_response_blocked ? 1 : 0,
      evaluation.is_flagged_for_review ? 1 : 0,
      evaluation.policy_profile_version,
      JSON.stringify(evaluation.performance),
      JSON.stringify(evaluation.cost),
      JSON.stringify(evaluation.responsibility),
      evaluation.timestamp,
    ],
  });

  return evaluation;
}

export async function getReviewDecisions(client: Client = getDb()): Promise<ReviewDecision[]> {
  const res = await client.execute(
    'SELECT * FROM review_decisions ORDER BY reviewed_at DESC',
  );

  return res.rows.map((row) => ({
    id: String(row.id),
    interaction_id: String(row.interaction_id),
    reviewed_at: String(row.reviewed_at),
    reviewer: String(row.reviewer),
    action: row.action as any,
    notes: String(row.notes || ''),
    edited_response: row.edited_response ? String(row.edited_response) : undefined,
    original_verdict: row.original_verdict as any,
    new_verdict: row.new_verdict as any,
    primary_trigger_lane: String(row.primary_trigger_lane),
  }));
}

export async function insertReviewDecision(
  decision: ReviewDecision,
  client: Client = getDb(),
): Promise<void> {
  await client.execute({
    sql: `INSERT OR REPLACE INTO review_decisions (
      id, interaction_id, reviewer, action, notes, edited_response,
      original_verdict, new_verdict, primary_trigger_lane, reviewed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      decision.id,
      decision.interaction_id,
      decision.reviewer,
      decision.action,
      decision.notes,
      decision.edited_response || null,
      decision.original_verdict,
      decision.new_verdict,
      decision.primary_trigger_lane,
      decision.reviewed_at,
    ],
  });
}

export async function getPolicyProfiles(
  client: Client = getDb(),
): Promise<Record<UseCaseId, PolicyProfile>> {
  const res = await client.execute('SELECT * FROM policy_profiles');
  const profiles: Record<string, PolicyProfile> = { ...DEFAULT_POLICY_PROFILES };

  for (const row of res.rows) {
    try {
      const parsed = JSON.parse(String(row.config_json));
      profiles[String(row.use_case)] = parsed;
    } catch {
      // fallback to default
    }
  }

  return profiles as Record<UseCaseId, PolicyProfile>;
}

export async function updatePolicyProfile(
  useCase: UseCaseId,
  profile: PolicyProfile,
  client: Client = getDb(),
): Promise<void> {
  await client.execute({
    sql: `INSERT OR REPLACE INTO policy_profiles (use_case, name, config_json, updated_at) VALUES (?, ?, ?, ?)`,
    args: [useCase, profile.name, JSON.stringify(profile), new Date().toISOString()],
  });
}

export async function resetDatabase(client: Client = getDb()): Promise<void> {
  await client.execute('DROP TABLE IF EXISTS review_decisions');
  await client.execute('DROP TABLE IF EXISTS evaluations');
  await client.execute('DROP TABLE IF EXISTS interactions');
  await client.execute('DROP TABLE IF EXISTS policy_profiles');
  await seedIfEmpty(client);
}

export async function getDatabaseStats(client: Client = getDb()) {
  const interactionsCount = await client.execute('SELECT COUNT(*) as c FROM interactions');
  const evaluationsCount = await client.execute('SELECT COUNT(*) as c FROM evaluations');
  const reviewsCount = await client.execute('SELECT COUNT(*) as c FROM review_decisions');
  const policiesCount = await client.execute('SELECT COUNT(*) as c FROM policy_profiles');

  return {
    interactions: Number(interactionsCount.rows[0]?.c ?? 0),
    evaluations: Number(evaluationsCount.rows[0]?.c ?? 0),
    reviews: Number(reviewsCount.rows[0]?.c ?? 0),
    policies: Number(policiesCount.rows[0]?.c ?? 0),
  };
}
