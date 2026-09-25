/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { evaluateInteraction } from '../lib/decisionEngine.js';
import { DEFAULT_POLICY_PROFILES } from '../lib/policyProfiles.js';
import type { SyntheticInteraction } from '../types.js';
import {
  emitGatewayEvent,
  getRecentGatewayEvents,
  minimizeGatewayEvent,
  addSSEClient,
  removeSSEClient,
  EVENT_EPOCH,
  type GatewayEvent,
} from './gatewayEvents.js';

function makeEvent(orgId: string, workspaceId: string, response: string): GatewayEvent {
  const interaction: SyntheticInteraction = {
    id: `gw-test-${Math.random().toString(36).slice(2)}`,
    use_case: 'support_bot',
    session_id: 's1',
    turn_number: 1,
    query_type: 'gateway_request',
    prompt: 'Contact me at jane.doe@example.com',
    retrieved_context: null,
    response,
    token_count: { prompt: 5, completion: 5, total: 10 },
    latency_ms: 100,
    ground_truth_labels: ['clean'],
    metadata: { created_at: new Date().toISOString() },
  };
  return {
    interaction,
    evaluation: evaluateInteraction(interaction, DEFAULT_POLICY_PROFILES.support_bot),
    tenantOrgId: orgId,
    tenantWorkspaceId: workspaceId,
    policyProfile: 'support_bot',
    model: 'test-model',
    isStreaming: false,
    timestamp: new Date().toISOString(),
  };
}

describe('Gateway event bus', () => {
  it('removes PII from prompts, responses, entities, and spans', () => {
    const minimized = minimizeGatewayEvent(
      makeEvent('org', 'ws', 'The customer SSN is 078-05-1120.'),
      'redacted',
    );
    const serialized = JSON.stringify(minimized);
    expect(serialized).not.toContain('078-05-1120');
    expect(serialized).not.toContain('jane.doe@example.com');
    expect(minimized.interaction.response).toContain('[REDACTED_SSN]');
    expect(minimized.evaluation.responsibility.pii_detected[0].text).toBe('[REDACTED_SSN]');
  });

  it('drops free text entirely in "none" mode', () => {
    const minimized = minimizeGatewayEvent(makeEvent('org', 'ws', 'hello'), 'none');
    expect(minimized.interaction.prompt).toBe('');
    expect(minimized.interaction.response).toBe('');
  });

  it('filters reads by org and workspace', () => {
    const { currentSeq } = getRecentGatewayEvents();
    emitGatewayEvent(makeEvent('org_x', 'ws1', 'a'));
    emitGatewayEvent(makeEvent('org_x', 'ws2', 'b'));
    emitGatewayEvent(makeEvent('org_y', 'ws1', 'c'));

    const orgX = getRecentGatewayEvents({ afterSeq: currentSeq, filter: { orgId: 'org_x' } });
    expect(orgX.events.map((e) => e.tenantWorkspaceId).sort()).toEqual(['ws1', 'ws2']);
    const ws2 = getRecentGatewayEvents({
      afterSeq: currentSeq,
      filter: { orgId: 'org_x', workspaceId: 'ws2' },
    });
    expect(ws2.events).toHaveLength(1);
    expect(getRecentGatewayEvents({ afterSeq: currentSeq }).events).toHaveLength(3);
  });

  it('resets cursors from another epoch or ahead of the sequence', () => {
    emitGatewayEvent(makeEvent('org_z', 'ws', 'x'));
    const sameEpoch = getRecentGatewayEvents({ epoch: EVENT_EPOCH, afterSeq: 0 });
    expect(sameEpoch.reset).toBe(false);
    expect(getRecentGatewayEvents({ epoch: 'other', afterSeq: 1 }).reset).toBe(true);
    const ahead = getRecentGatewayEvents({
      epoch: EVENT_EPOCH,
      afterSeq: sameEpoch.currentSeq + 50,
    });
    expect(ahead.reset).toBe(true);
    expect(ahead.events.length).toBeGreaterThan(0);
  });

  it('delivers SSE only to matching tenants and drops slow consumers', () => {
    const makeClient = (writableLength = 0) => {
      const writes: string[] = [];
      return {
        writes,
        ended: false,
        writableLength,
        write(chunk: string) {
          writes.push(chunk);
          return writableLength === 0;
        },
        end() {
          this.ended = true;
        },
      } as any;
    };
    const tenantA = makeClient();
    const tenantB = makeClient();
    const slow = makeClient(2 * 1024 * 1024);
    addSSEClient(tenantA, { orgId: 'org_sse_a' });
    addSSEClient(tenantB, { orgId: 'org_sse_b' });
    addSSEClient(slow, { orgId: 'org_sse_a' });
    try {
      emitGatewayEvent(makeEvent('org_sse_a', 'ws', 'hi'));
      expect(tenantA.writes).toHaveLength(1);
      expect(tenantB.writes).toHaveLength(0);
      expect(slow.ended).toBe(true);

      emitGatewayEvent(makeEvent('org_sse_a', 'ws', 'again'));
      expect(slow.writes).toHaveLength(1); // removed after the first overflow
    } finally {
      removeSSEClient(tenantA);
      removeSSEClient(tenantB);
      removeSSEClient(slow);
    }
  });
});
