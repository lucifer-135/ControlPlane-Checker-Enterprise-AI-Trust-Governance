/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Gateway Event Bus — Server-Sent Events (SSE) for Live Feed & Review Queue
 *
 * Captures real gateway evaluation results and makes them available to:
 * 1. Live Feed (via SSE streaming or polling endpoint)
 * 2. Review Queue (BLOCK_ESCALATE verdicts are also persisted to SQLite)
 *
 * Guarantees:
 * - Payload minimization: prompts/responses are PII-redacted and truncated
 *   before they enter the buffer (CONTROLPLANE_EVENT_PAYLOADS=redacted|none|full).
 * - Tenant isolation: every read and every SSE subscription is filtered by the
 *   caller's org/workspace.
 * - Retention: events expire after CONTROLPLANE_EVENT_TTL_MS, with a per-org cap
 *   and a global cap. The review queue does NOT depend on this buffer.
 * - Backpressure: slow SSE subscribers are disconnected instead of buffering
 *   unbounded data; the number of subscribers is capped.
 * - Cursor safety: sequence numbers restart on process restart, so every
 *   response carries an `epoch` that identifies this server instance.
 */

import crypto from 'crypto';
import type { Response } from 'express';
import type {
  EvaluationResult,
  ResponsibilityLaneResult,
  SpanHighlight,
  SyntheticInteraction,
} from '../types.js';
import { evaluateResponsibilityLane } from '../lib/lanes/responsibilityLane.js';
import {
  insertGatewayEscalation,
  getPendingGatewayEscalations,
  type TenantFilter,
} from './db/database.js';
import { tenantMatches } from './auth.js';
import { isProduction } from './config.js';

export interface GatewayEvent {
  interaction: SyntheticInteraction;
  evaluation: EvaluationResult;
  tenantOrgId: string;
  tenantWorkspaceId: string;
  policyProfile: string;
  model: string;
  isStreaming: boolean;
  timestamp: string;
}

export interface SequencedGatewayEvent extends GatewayEvent {
  seq: number;
}

// ──────────────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────────────

function envInt(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const MAX_EVENT_HISTORY = envInt('CONTROLPLANE_EVENT_MAX_TOTAL', 2000);
const MAX_EVENTS_PER_ORG = envInt('CONTROLPLANE_EVENT_MAX_PER_ORG', 500);
const EVENT_TTL_MS = envInt('CONTROLPLANE_EVENT_TTL_MS', 60 * 60 * 1000);
const MAX_SSE_CLIENTS = envInt('CONTROLPLANE_SSE_MAX_CLIENTS', 50);
const SSE_MAX_BUFFERED_BYTES = 1024 * 1024;
const MAX_TEXT_CHARS = 4000;

type PayloadMode = 'redacted' | 'none' | 'full';

function getPayloadMode(): PayloadMode {
  const mode = (process.env.CONTROLPLANE_EVENT_PAYLOADS || '').toLowerCase();
  if (mode === 'none') return 'none';
  // Unredacted payloads are a local debugging aid only.
  if (mode === 'full' && !isProduction()) return 'full';
  return 'redacted';
}

// ──────────────────────────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────────────────────────

/** Identifies this server process; changes on every restart. */
export const EVENT_EPOCH = crypto.randomUUID();

interface StoredEvent {
  event: SequencedGatewayEvent;
  receivedAt: number;
}

const eventHistory: StoredEvent[] = [];
let eventSequence = 0;

interface SSEClient {
  res: Response;
  filter: TenantFilter | undefined;
}

const sseClients: Set<SSEClient> = new Set();

// ──────────────────────────────────────────────────────────────────────
// Payload minimization
// ──────────────────────────────────────────────────────────────────────

function truncate(text: string): string {
  return text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}… [truncated]` : text;
}

function piiPlaceholders(responsibility: ResponsibilityLaneResult): Map<string, string> {
  const placeholderFor = new Map<string, string>();
  for (const pii of responsibility.pii_detected) {
    placeholderFor.set(pii.text, `[REDACTED_${pii.type}]`);
  }
  return placeholderFor;
}

/**
 * Returns the responsibility lane's triggering spans with PII text (and its
 * echo in the reason) replaced by the placeholder used in the redacted response.
 */
export function redactPiiSpans(responsibility: ResponsibilityLaneResult): SpanHighlight[] {
  const placeholderFor = piiPlaceholders(responsibility);
  return responsibility.triggering_spans.map((s) => {
    if (s.type !== 'pii') return s;
    const placeholder = placeholderFor.get(s.text) || '[REDACTED]';
    return { ...s, text: placeholder, reason: s.reason.split(s.text).join(placeholder) };
  });
}

/**
 * Returns a copy of the event with PII removed from every free-text field and
 * long texts truncated. Span text for PII is replaced by the same placeholder
 * used in the redacted response, so UI highlighting still lines up.
 */
export function minimizeGatewayEvent(
  event: GatewayEvent,
  mode: PayloadMode = getPayloadMode(),
): GatewayEvent {
  if (mode === 'full') return event;

  const { interaction, evaluation } = event;
  const responsibility = evaluation.responsibility;
  const placeholderFor = piiPlaceholders(responsibility);

  let prompt = '';
  let response = '';
  if (mode === 'redacted') {
    prompt = truncate(evaluateResponsibilityLane(interaction.prompt || '').redacted_response);
    response = truncate(responsibility.redacted_response || '');
  }

  return {
    ...event,
    interaction: {
      ...interaction,
      prompt,
      response,
      retrieved_context: null,
    },
    evaluation: {
      ...evaluation,
      responsibility: {
        ...responsibility,
        redacted_response: response,
        pii_detected: responsibility.pii_detected.map((p) => ({
          ...p,
          text: placeholderFor.get(p.text) || '[REDACTED]',
        })),
        triggering_spans: redactPiiSpans(responsibility),
      },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────
// Retention
// ──────────────────────────────────────────────────────────────────────

function enforceRetention(now: number): void {
  // Drop expired events (history is in arrival order).
  while (eventHistory.length > 0 && now - eventHistory[0].receivedAt > EVENT_TTL_MS) {
    eventHistory.shift();
  }
  while (eventHistory.length > MAX_EVENT_HISTORY) {
    eventHistory.shift();
  }
}

function enforceOrgCap(orgId: string): void {
  let count = 0;
  for (const e of eventHistory) {
    if (e.event.tenantOrgId === orgId) count++;
  }
  for (let i = 0; count > MAX_EVENTS_PER_ORG && i < eventHistory.length;) {
    if (eventHistory[i].event.tenantOrgId === orgId) {
      eventHistory.splice(i, 1);
      count--;
    } else {
      i++;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// Emit / Query
// ──────────────────────────────────────────────────────────────────────

/**
 * Emit a new gateway event into the event bus.
 * Called by gateway.ts and streamInterceptor.ts after each evaluation.
 */
export function emitGatewayEvent(rawEvent: GatewayEvent): void {
  const now = Date.now();
  eventSequence++;
  const event: SequencedGatewayEvent = { ...minimizeGatewayEvent(rawEvent), seq: eventSequence };

  eventHistory.push({ event, receivedAt: now });
  enforceRetention(now);
  enforceOrgCap(event.tenantOrgId);

  // Escalations are persisted so the review queue survives restarts and buffer eviction.
  if (event.evaluation.verdict === 'BLOCK_ESCALATE') {
    try {
      insertGatewayEscalation(
        event.interaction.id,
        { orgId: event.tenantOrgId, workspaceId: event.tenantWorkspaceId },
        JSON.stringify(event),
      );
    } catch (err) {
      console.warn('[GatewayEvents] Failed to persist escalation:', err);
    }
  }

  const ssePayload = `data: ${JSON.stringify(event)}\n\n`;
  let delivered = 0;
  for (const client of sseClients) {
    if (!tenantMatches(client.filter, event.tenantOrgId, event.tenantWorkspaceId)) continue;
    try {
      const ok = client.res.write(ssePayload);
      delivered++;
      if (!ok && client.res.writableLength > SSE_MAX_BUFFERED_BYTES) {
        // Slow consumer: disconnect rather than buffer without bound.
        sseClients.delete(client);
        client.res.end();
      }
    } catch {
      sseClients.delete(client);
    }
  }

  console.log(
    `[GatewayEvents] Event #${eventSequence}: ${event.evaluation.verdict} (${event.interaction.id}) → ${delivered} SSE subscribers`,
  );
}

export interface GatewayEventQuery {
  limit?: number;
  afterSeq?: number;
  /** Epoch the caller's cursor belongs to. A mismatch resets the cursor. */
  epoch?: string;
  filter?: TenantFilter;
}

export interface GatewayEventPage {
  events: SequencedGatewayEvent[];
  currentSeq: number;
  epoch: string;
  /** True when the caller's cursor was discarded (server restarted or cursor ahead). */
  reset: boolean;
}

/**
 * Returns recent gateway events visible to the caller (for polling).
 */
export function getRecentGatewayEvents(query: GatewayEventQuery = {}): GatewayEventPage {
  enforceRetention(Date.now());
  const limit = Math.max(1, Math.min(query.limit ?? 50, 500));
  let afterSeq = Math.max(0, query.afterSeq ?? 0);

  const reset =
    (query.epoch !== undefined && query.epoch !== '' && query.epoch !== EVENT_EPOCH) ||
    afterSeq > eventSequence;
  if (reset) afterSeq = 0;

  const events = eventHistory
    .map((e) => e.event)
    .filter(
      (e) => e.seq > afterSeq && tenantMatches(query.filter, e.tenantOrgId, e.tenantWorkspaceId),
    );

  return {
    events: events.slice(-limit),
    currentSeq: eventSequence,
    epoch: EVENT_EPOCH,
    reset,
  };
}

/**
 * Returns persisted BLOCK_ESCALATE events that have no review decision yet.
 */
export function getPendingEscalations(limit: number = 100, filter?: TenantFilter): GatewayEvent[] {
  const events: GatewayEvent[] = [];
  for (const json of getPendingGatewayEscalations(limit, filter)) {
    try {
      events.push(JSON.parse(json));
    } catch {
      // Skip corrupt rows
    }
  }
  return events;
}

/**
 * Registers an SSE client connection for real-time gateway event streaming.
 * Returns false when the subscriber cap has been reached.
 */
export function addSSEClient(res: Response, filter?: TenantFilter): boolean {
  if (sseClients.size >= MAX_SSE_CLIENTS) return false;
  sseClients.add({ res, filter });
  return true;
}

/**
 * Removes an SSE client connection.
 */
export function removeSSEClient(res: Response): void {
  for (const client of sseClients) {
    if (client.res === res) sseClients.delete(client);
  }
}

/**
 * Returns the current event sequence number.
 */
export function getCurrentSequence(): number {
  return eventSequence;
}
