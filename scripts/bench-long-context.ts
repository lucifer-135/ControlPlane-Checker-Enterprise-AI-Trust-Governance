/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Long-context evaluation benchmark.
 *
 * Measures the governance engine's added latency as retrieved context grows
 * from ~2k to ~32k tokens — the sizes production RAG calls actually send.
 *
 *   npm run bench
 */

import { evaluateInteraction } from '../src/lib/decisionEngine';
import { DEFAULT_POLICY_PROFILES } from '../src/lib/policyProfiles';
import type { SyntheticInteraction } from '../src/types';

const SENTENCES = [
  'Section {n}.1: Refund requests for annual plans submitted within 30 days of renewal are eligible for a prorated credit.',
  'Section {n}.2: Enterprise customers on the Growth tier receive 99.9% uptime commitments measured monthly.',
  'Ticket INC-{n}42: the payments gateway returned HTTP 503 for 14 minutes; failover to region eu-west-2 completed.',
  'Claim note {n}: adjuster verified the invoice total of ${n}20.50 against the purchase order and the delivery receipt.',
  'Policy {n}.4: data exports containing customer identifiers must be encrypted at rest with AES-256 and retained 90 days.',
  'Runbook step {n}: rotate the service credentials, redeploy the ingress controller, and confirm health checks pass.',
];

function buildContext(targetTokens: number): string {
  const parts: string[] = [];
  let chars = 0;
  for (let n = 1; chars < targetTokens * 4; n++) {
    const s = SENTENCES[n % SENTENCES.length].replace(/\{n\}/g, String(n));
    parts.push(s);
    chars += s.length + 1;
  }
  return parts.join(' ');
}

const RESPONSE =
  'Per Section 1.1, refund requests for annual plans submitted within 30 days of renewal are eligible for a prorated credit. ' +
  'Enterprise customers on the Growth tier also receive 99.9% uptime commitments. ' +
  'Please confirm the renewal date so we can process the credit.';

function makeInteraction(contextTokens: number): SyntheticInteraction {
  const context = buildContext(contextTokens);
  return {
    id: `bench-${contextTokens}`,
    use_case: 'support_bot',
    session_id: 'bench',
    turn_number: 1,
    // Its own workload, so the cost lane is not comparing 32k-token requests to a chat baseline
    query_type: 'bench_long_context',
    prompt: 'Am I eligible for a refund on my annual plan renewal?',
    retrieved_context: context,
    response: RESPONSE,
    token_count: { prompt: contextTokens, completion: 60, total: contextTokens + 60 },
    latency_ms: 900,
    ground_truth_labels: ['clean'],
    metadata: {},
  };
}

const RUNS = 20;
console.log('context tokens | median ms | p95 ms | verdict');
for (const tokens of [2_000, 8_000, 32_000]) {
  const interaction = makeInteraction(tokens);
  evaluateInteraction(interaction, DEFAULT_POLICY_PROFILES.support_bot); // warm-up
  const times: number[] = [];
  let verdict = '';
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    verdict = evaluateInteraction(interaction, DEFAULT_POLICY_PROFILES.support_bot).verdict;
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(RUNS / 2)];
  const p95 = times[Math.floor(RUNS * 0.95) - 1];
  console.log(
    `${String(tokens).padStart(14)} | ${median.toFixed(1).padStart(9)} | ${p95.toFixed(1).padStart(6)} | ${verdict}`,
  );
}
