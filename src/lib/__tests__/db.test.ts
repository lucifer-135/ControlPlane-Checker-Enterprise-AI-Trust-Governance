/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, Client } from '@libsql/client';
import {
  initDb,
  seedIfEmpty,
  getAllInteractions,
  insertInteractionWithEvaluation,
  getReviewDecisions,
  insertReviewDecision,
  clearReviewDecisions,
  deleteReviewDecision,
  getPolicyProfiles,
  updatePolicyProfile,
  resetDatabase,
  getDatabaseStats,
} from '../../server/db';
import { DEFAULT_POLICY_PROFILES } from '../policyProfiles';
import type { ReviewDecision, SyntheticInteraction } from '../../types';

describe('SQLite Database Layer', () => {
  let testClient: Client;

  beforeEach(async () => {
    // Create isolated in-memory SQLite database for each test
    testClient = createClient({ url: ':memory:' });
    await initDb(testClient);
  });

  describe('Initialization & Seeding', () => {
    it('should create all required tables without error', async () => {
      const stats = await getDatabaseStats(testClient);
      expect(stats.interactions).toBe(0);
      expect(stats.evaluations).toBe(0);
      expect(stats.reviews).toBe(0);
      expect(stats.policies).toBe(0);
    });

    it('should seed synthetic interactions and policy profiles on first run', async () => {
      const result = await seedIfEmpty(testClient);

      expect(result.seeded).toBe(true);
      expect(result.count).toBeGreaterThan(0);

      const stats = await getDatabaseStats(testClient);
      expect(stats.interactions).toBe(result.count);
      expect(stats.evaluations).toBe(result.count);
      expect(stats.policies).toBe(3); // support_bot, internal_copilot, decision_support
    });

    it('should not re-seed if interactions already exist', async () => {
      await seedIfEmpty(testClient);
      const secondRun = await seedIfEmpty(testClient);

      expect(secondRun.seeded).toBe(false);
    });
  });

  describe('Interactions & Telemetry Ledger', () => {
    beforeEach(async () => {
      await seedIfEmpty(testClient);
    });

    it('should fetch all interactions with evaluation data', async () => {
      const { interactions, evaluations } = await getAllInteractions(testClient);

      expect(interactions.length).toBeGreaterThan(0);
      expect(Object.keys(evaluations).length).toBe(interactions.length);

      const first = interactions[0];
      expect(evaluations[first.id]).toBeDefined();
      expect(evaluations[first.id].verdict).toBeDefined();
      expect(evaluations[first.id].composite_risk_score).toBeGreaterThanOrEqual(0);
    });

    it('should filter interactions by use case', async () => {
      const { interactions } = await getAllInteractions(testClient, 'support_bot');

      expect(interactions.length).toBeGreaterThan(0);
      expect(interactions.every((i) => i.use_case === 'support_bot')).toBe(true);
    });

    it('should insert a new interaction and calculate/persist its evaluation', async () => {
      const newInteraction: SyntheticInteraction = {
        id: 'custom-db-test-01',
        use_case: 'support_bot',
        session_id: 'sess-custom',
        turn_number: 1,
        query_type: 'refund_inquiry',
        prompt: 'Can I get a full refund?',
        retrieved_context: 'All sales are final.',
        response: 'All sales are strictly non-refundable.',
        token_count: { prompt: 20, completion: 20, total: 40 },
        latency_ms: 200,
        tool_calls_count: 0,
        ground_truth_labels: ['clean'],
        metadata: { created_at: new Date().toISOString() },
      };

      const evaluation = await insertInteractionWithEvaluation(
        newInteraction,
        DEFAULT_POLICY_PROFILES.support_bot,
        testClient,
      );

      expect(evaluation.interaction_id).toBe('custom-db-test-01');
      expect(evaluation.verdict).toBe('ALLOW');

      const { interactions, evaluations } = await getAllInteractions(testClient);
      expect(interactions.some((i) => i.id === 'custom-db-test-01')).toBe(true);
      expect(evaluations['custom-db-test-01']).toBeDefined();
    });
  });

  describe('Human Review Adjudications', () => {
    beforeEach(async () => {
      await seedIfEmpty(testClient);
    });

    it('should insert and retrieve review decisions in chronological order', async () => {
      const { interactions } = await getAllInteractions(testClient);
      const targetId1 = interactions[0].id;
      const targetId2 = interactions[1].id;

      const decision1: ReviewDecision = {
        id: 'rev-01',
        interaction_id: targetId1,
        reviewed_at: '2025-01-01T10:00:00Z',
        reviewer: 'compliance_officer_1',
        action: 'CONFIRM_BLOCK',
        notes: 'Confirmed severe PII leak.',
        original_verdict: 'BLOCK_ESCALATE',
        new_verdict: 'BLOCK_ESCALATE',
        primary_trigger_lane: 'Responsibility',
      };

      const decision2: ReviewDecision = {
        id: 'rev-02',
        interaction_id: targetId2,
        reviewed_at: '2025-01-02T12:00:00Z',
        reviewer: 'compliance_officer_2',
        action: 'OVERRIDE_ALLOW',
        notes: 'False positive hallucination trigger.',
        original_verdict: 'BLOCK_ESCALATE',
        new_verdict: 'ALLOW',
        primary_trigger_lane: 'Performance',
      };

      await insertReviewDecision(decision1, testClient);
      await insertReviewDecision(decision2, testClient);

      const reviews = await getReviewDecisions(testClient);
      expect(reviews).toHaveLength(2);
      // Most recent first
      expect(reviews[0].id).toBe('rev-02');
      expect(reviews[1].id).toBe('rev-01');
    });

    it('should delete an individual review decision by id or interaction_id', async () => {
      const { interactions } = await getAllInteractions(testClient);

      await insertReviewDecision(
        {
          id: 'rev-delete-test',
          interaction_id: interactions[0].id,
          reviewed_at: '2025-01-01T10:00:00Z',
          reviewer: 'compliance_officer_1',
          action: 'CONFIRM_BLOCK',
          notes: 'Test note',
          original_verdict: 'BLOCK_ESCALATE',
          new_verdict: 'BLOCK_ESCALATE',
          primary_trigger_lane: 'Responsibility',
        },
        testClient,
      );

      let reviews = await getReviewDecisions(testClient);
      expect(reviews).toHaveLength(1);

      await deleteReviewDecision('rev-delete-test', testClient);

      reviews = await getReviewDecisions(testClient);
      expect(reviews).toHaveLength(0);
    });

    it('should clear all review decisions in a session', async () => {
      const { interactions } = await getAllInteractions(testClient);

      await insertReviewDecision(
        {
          id: 'rev-1',
          interaction_id: interactions[0].id,
          reviewed_at: '2025-01-01T10:00:00Z',
          reviewer: 'officer',
          action: 'CONFIRM_BLOCK',
          notes: 'Test note 1',
          original_verdict: 'BLOCK_ESCALATE',
          new_verdict: 'BLOCK_ESCALATE',
          primary_trigger_lane: 'Responsibility',
        },
        testClient,
      );
      await insertReviewDecision(
        {
          id: 'rev-2',
          interaction_id: interactions[1].id,
          reviewed_at: '2025-01-01T11:00:00Z',
          reviewer: 'officer',
          action: 'OVERRIDE_ALLOW',
          notes: 'Test note 2',
          original_verdict: 'BLOCK_ESCALATE',
          new_verdict: 'ALLOW',
          primary_trigger_lane: 'Performance',
        },
        testClient,
      );

      let stats = await getDatabaseStats(testClient);
      expect(stats.reviews).toBe(2);

      await clearReviewDecisions(testClient);

      stats = await getDatabaseStats(testClient);
      expect(stats.reviews).toBe(0);
    });
  });

  describe('Policy Profile Storage', () => {
    beforeEach(async () => {
      await seedIfEmpty(testClient);
    });

    it('should load default policy profiles', async () => {
      const profiles = await getPolicyProfiles(testClient);

      expect(profiles.support_bot).toBeDefined();
      expect(profiles.internal_copilot).toBeDefined();
      expect(profiles.decision_support).toBeDefined();
    });

    it('should persist modified policy profiles', async () => {
      const modified = {
        ...DEFAULT_POLICY_PROFILES.support_bot,
        thresholds: {
          ...DEFAULT_POLICY_PROFILES.support_bot.thresholds,
          block_escalate: 0.85,
        },
      };

      await updatePolicyProfile('support_bot', modified, testClient);

      const profiles = await getPolicyProfiles(testClient);
      expect(profiles.support_bot.thresholds.block_escalate).toBe(0.85);
    });
  });

  describe('Database Reset', () => {
    it('should drop and re-seed all tables', async () => {
      await seedIfEmpty(testClient);
      const { interactions } = await getAllInteractions(testClient);

      await insertReviewDecision(
        {
          id: 'temp-rev',
          interaction_id: interactions[0].id,
          reviewer: 'test',
          action: 'CONFIRM_BLOCK',
          notes: 'test',
          original_verdict: 'BLOCK_ESCALATE',
          new_verdict: 'BLOCK_ESCALATE',
          primary_trigger_lane: 'Cost',
          reviewed_at: new Date().toISOString(),
        },
        testClient,
      );

      let stats = await getDatabaseStats(testClient);
      expect(stats.reviews).toBe(1);

      await resetDatabase(testClient);

      stats = await getDatabaseStats(testClient);
      expect(stats.reviews).toBe(0);
      expect(stats.interactions).toBeGreaterThan(0);
    });
  });
});
