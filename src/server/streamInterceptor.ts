/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stream Interceptor — Real-time Holdback SSE Interceptor
 *
 * Intercepts Server-Sent Events (SSE) streaming from upstream LLM:
 * 1. Holdback buffer: the newest HOLDBACK_CHARS of every text field are held in the
 *    gateway and released only once no sensitive pattern can still be forming, so not
 *    even a partial SSN or card number reaches the client (~12 tokens of added delay)
 * 2. Deterministic Tier 1 checks on content, reasoning and tool-call arguments of every choice:
 *    - PII leakage (SSN, credit card with Luhn verification)
 *    - Leaked secrets (AWS credentials, bearer tokens, API keys)
 * 3. Enforcement:
 *    - pre_response_blocking policies: terminate the stream with finish_reason: "content_filter"
 *    - other policies: redact the match inline ([REDACTED_SSN], ...) and keep streaming
 *    - FAIL_CLOSED policies: an event that cannot be parsed ends the stream instead of passing through
 * 4. Full response accumulation for background Tier 2/3 governance evaluation
 */

import crypto from 'crypto';
import type { Response } from 'express';
import { isValidLuhn } from '../lib/utils/luhn.js';
import { evaluateInteraction } from '../lib/decisionEngine.js';
import type { PolicyProfile, SessionState, SyntheticInteraction } from '../types.js';
import { globalBaselineTracker } from './rollingBaseline.js';
import { insertAuditLog } from './db/database.js';
import { recordEvaluationTelemetry } from './telemetry.js';
import { emitGatewayEvent } from './gatewayEvents.js';

/** Characters held back per field; must exceed the longest pattern prefix that can still be incomplete. */
export const HOLDBACK_CHARS = 48;
/** Already-released characters re-scanned for word boundaries at the start of the held text. */
const CONTEXT_CHARS = 16;

/** Text-bearing string fields of a streaming delta. */
const DELTA_TEXT_FIELDS = ['content', 'reasoning_content', 'reasoning'] as const;

type ViolationKind = 'AWS_SECRET' | 'API_KEY' | 'SSN' | 'CREDIT_CARD';

interface StreamViolation {
  start: number;
  end: number;
  kind: ViolationKind;
  reason: string;
}

// Global regexes, used only through matchAll (which clones them, so lastIndex never leaks)
const STREAM_PATTERNS: { kind: ViolationKind; regex: RegExp; reason: string }[] = [
  {
    kind: 'AWS_SECRET',
    regex: /AKIA[0-9A-Z]{16}|aws_secret_access_key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}/gi,
    reason: 'Detected active AWS API credential in streaming output',
  },
  {
    kind: 'API_KEY',
    regex: /bearer\s+[A-Za-z0-9_\-.]{24,}|api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9_\-]{20,}/gi,
    reason: 'Detected exposed API key token in streaming output',
  },
  {
    kind: 'SSN',
    regex: /\b(?!000|666|9\d{2})\d{3}[- ](?!00)\d{2}[- ](?!0000)\d{4}\b/g,
    reason: 'Detected Social Security Number (SSN) in streaming output',
  },
];

const CARD_REASON = 'Detected valid Luhn-verified credit card number in streaming output';

/**
 * Finds Luhn-valid 13–19 digit card numbers. Every run of digit groups is checked at each
 * group boundary, so a non-card number earlier in the run cannot hide a real card after it.
 */
function findCardNumbers(text: string): StreamViolation[] {
  const found: StreamViolation[] = [];
  for (const run of text.matchAll(/\d+(?:[ -]\d+)*/g)) {
    const groups = [...run[0].matchAll(/\d+/g)].map((g) => ({
      start: run.index! + g.index!,
      end: run.index! + g.index! + g[0].length,
      digits: g[0],
    }));
    let s = 0;
    while (s < groups.length) {
      let matchedEnd = -1;
      let digits = '';
      for (let e = s; e < groups.length && digits.length + groups[e].digits.length <= 19; e++) {
        digits += groups[e].digits;
        if (digits.length >= 13 && isValidLuhn(digits)) matchedEnd = e; // prefer the longest
      }
      if (matchedEnd >= 0) {
        found.push({
          start: groups[s].start,
          end: groups[matchedEnd].end,
          kind: 'CREDIT_CARD',
          reason: CARD_REASON,
        });
        s = matchedEnd + 1;
      } else {
        s++;
      }
    }
  }
  return found;
}

/**
 * Scans text for hard deterministic breaches. Returns non-overlapping violations sorted by start.
 */
export function findStreamViolations(text: string): StreamViolation[] {
  const all: StreamViolation[] = findCardNumbers(text);
  for (const { kind, regex, reason } of STREAM_PATTERNS) {
    for (const m of text.matchAll(regex)) {
      all.push({ start: m.index!, end: m.index! + m[0].length, kind, reason });
    }
  }
  all.sort((a, b) => a.start - b.start || b.end - a.end);
  const result: StreamViolation[] = [];
  for (const v of all) {
    if (result.length === 0 || v.start >= result[result.length - 1].end) result.push(v);
  }
  return result;
}

interface FieldState {
  /** Text received from upstream but not yet released to the client. */
  pending: string;
  /** Tail of already-released text, used only for boundary-aware scanning. */
  context: string;
}

interface GuardResult {
  release: string;
  blocked?: StreamViolation;
  redacted: StreamViolation[];
}

/**
 * Adds a delta to a field's holdback buffer and decides what can safely be released.
 * A match that touches the end of the buffer may still grow, so it is only acted on
 * once more text arrives or the field is flushed (`final`).
 */
function guardField(
  state: FieldState,
  delta: string,
  final: boolean,
  redact: boolean,
): GuardResult {
  state.pending += delta;
  const offset = state.context.length;
  const scanText = state.context + state.pending;
  const closed = findStreamViolations(scanText).filter(
    (v) => v.end > offset && (final || v.end < scanText.length),
  );

  if (closed.length > 0 && !redact) {
    // Clean text before the violation may still go out ahead of the cut marker
    const safe = state.pending.slice(0, Math.max(closed[0].start - offset, 0));
    return { release: safe, blocked: closed[0], redacted: [] };
  }

  // Redact right-to-left so earlier offsets stay valid
  let pending = state.pending;
  for (const v of [...closed].reverse()) {
    const start = Math.max(v.start - offset, 0);
    pending = pending.slice(0, start) + `[REDACTED_${v.kind}]` + pending.slice(v.end - offset);
  }

  let releaseEnd = pending.length;
  if (!final) {
    releaseEnd = Math.max(pending.length - HOLDBACK_CHARS, 0);
    const rescan = state.context + pending;
    for (const v of findStreamViolations(rescan)) {
      if (v.end === rescan.length) releaseEnd = Math.min(releaseEnd, Math.max(v.start - offset, 0));
    }
  }

  const release = pending.slice(0, releaseEnd);
  state.pending = pending.slice(releaseEnd);
  state.context = (state.context + release).slice(-CONTEXT_CHARS);
  return { release, redacted: closed };
}

/** Request context carried from the gateway so stream records match the real caller. */
export interface StreamContext {
  tenantOrgId: string;
  tenantWorkspaceId: string;
  sessionId: string;
  model: string;
  policyKey: string;
}

export interface StreamAuditLog {
  fullText: string;
  tokenCountEstimate: number;
  hardViolationDetected: boolean;
  violationReason?: string;
  /** Kinds of matches redacted inline (policies without pre_response_blocking). */
  redactedTypes: string[];
  ttftMs: number;
  totalDurationMs: number;
}

/**
 * Intercepts an SSE stream from upstream and pipes to Express client response.
 */
export async function interceptStream(
  upstreamResponse: globalThis.Response,
  clientRes: Response,
  policy: PolicyProfile,
  userPrompt: string,
  sessionState: SessionState,
  turnNumber: number,
  context?: StreamContext,
): Promise<StreamAuditLog> {
  const streamStart = performance.now();
  const ctx: StreamContext = context ?? {
    tenantOrgId: 'anonymous',
    tenantWorkspaceId: 'default',
    sessionId: `stream-session-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    model: 'unknown-stream-model',
    policyKey: policy.use_case,
  };
  const redact = !policy.pre_response_blocking;
  const failClosed = policy.failMode === 'FAIL_CLOSED';
  let upstreamUsage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null = null;
  let firstTokenTime: number | null = null;
  // Raw (unredacted) text per choice, for governance evaluation
  const choiceText = new Map<number, string>();
  // Holdback buffers keyed by choice index, then by field ('content', 'tool:<n>', ...)
  const buffers = new Map<number, Map<string, FieldState>>();
  const redactedTypes: string[] = [];
  let hardViolation = false;
  let violationReason: string | undefined;
  let clientClosed = false;
  let lastId: string | undefined;
  let lastModel: string | undefined;
  // Clean content released just before a cut, sent ahead of the cut marker
  let cutPrefix = { choice: 0, text: '' };

  // Set SSE response headers
  clientRes.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-ControlPlane-Intercepted': 'true',
    'X-ControlPlane-Policy': policy.use_case,
  });

  const reader = upstreamResponse.body?.getReader();
  if (!reader) {
    clientRes.write(
      `data: ${JSON.stringify({ error: 'No readable stream available from upstream' })}\n\n`,
    );
    clientRes.end();
    return {
      fullText: '',
      tokenCountEstimate: 0,
      hardViolationDetected: false,
      redactedTypes: [],
      ttftMs: 0,
      totalDurationMs: performance.now() - streamStart,
    };
  }

  // Stop reading upstream as soon as the client goes away
  const onClientClose = () => {
    clientClosed = true;
    reader.cancel().catch(() => {});
  };
  clientRes.on?.('close', onClientClose);

  const send = (data: string) => {
    if (!clientClosed && !clientRes.writableEnded) clientRes.write(data);
  };

  const fieldState = (choice: number, field: string): FieldState => {
    let fields = buffers.get(choice);
    if (!fields) buffers.set(choice, (fields = new Map()));
    let state = fields.get(field);
    if (!state) fields.set(field, (state = { pending: '', context: '' }));
    return state;
  };

  const markReleased = (text: string) => {
    if (text && firstTokenTime === null) firstTokenTime = performance.now() - streamStart;
  };

  /** Runs one field delta through the guard; returns the text to send, or null if the stream was cut. */
  const guard = (choice: number, field: string, delta: string, final: boolean): string | null => {
    const result = guardField(fieldState(choice, field), delta, final, redact);
    if (result.blocked) {
      hardViolation = true;
      violationReason = result.blocked.reason;
      if (field === 'content') cutPrefix = { choice, text: result.release };
      return null;
    }
    for (const v of result.redacted) {
      redactedTypes.push(v.kind);
      console.warn(`[StreamInterceptor] Redacted mid-stream: ${v.reason}`);
    }
    markReleased(result.release);
    return result.release;
  };

  const cutStream = async (reason: string) => {
    hardViolation = true;
    violationReason = reason;
    console.warn(`[StreamInterceptor] Hard violation cut stream: ${reason}`);
    await reader.cancel().catch(() => {});
    const cutChunk = {
      id: lastId || `cp-cut-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: lastModel,
      choices: [
        {
          index: cutPrefix.choice,
          delta: {
            content:
              cutPrefix.text +
              '\n\n[STREAM INTERCEPTED BY CONTROLPLANE: Content filter policy triggered]',
          },
          finish_reason: 'content_filter',
        },
      ],
      governance_breach: {
        reason,
        policy_action: 'STREAM_TERMINATED',
      },
    };
    send(`data: ${JSON.stringify(cutChunk)}\n\n`);
    send('data: [DONE]\n\n');
    if (!clientRes.writableEnded) clientRes.end();
  };

  /** Flushes every field of a choice into `delta` (final scan). Returns false if the stream was cut. */
  const flushChoiceInto = (choice: number, delta: any): boolean => {
    const fields = buffers.get(choice);
    if (!fields) return true;
    for (const [field, state] of fields) {
      if (!state.pending) continue;
      const release = guard(choice, field, '', true);
      if (release === null) return false;
      if (!release) continue;
      if (field.startsWith('tool:')) {
        const index = Number(field.slice(5));
        delta.tool_calls ??= [];
        let call = delta.tool_calls.find((c: any) => (c.index ?? 0) === index);
        if (!call) delta.tool_calls.push((call = { index, function: { arguments: '' } }));
        call.function ??= {};
        call.function.arguments = (call.function.arguments ?? '') + release;
      } else {
        delta[field] = (delta[field] ?? '') + release;
      }
    }
    return true;
  };

  /** Guards a parsed chunk in place. Returns false if the stream was cut, 'drop' if nothing is left to send. */
  const guardChunk = (parsed: any): boolean | 'drop' => {
    if (!Array.isArray(parsed.choices)) return true;
    let hasPayload = parsed.choices.length === 0 || parsed.usage != null;
    for (const [position, choice] of parsed.choices.entries()) {
      const index: number = typeof choice.index === 'number' ? choice.index : position;
      const final = choice.finish_reason != null;
      const delta = choice.delta && typeof choice.delta === 'object' ? choice.delta : null;

      if (delta) {
        for (const field of DELTA_TEXT_FIELDS) {
          if (typeof delta[field] !== 'string') continue;
          if (field === 'content')
            choiceText.set(index, (choiceText.get(index) ?? '') + delta[field]);
          const release = guard(index, field, delta[field], false);
          if (release === null) return false;
          if (release) delta[field] = release;
          else delete delta[field];
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const [n, call] of delta.tool_calls.entries()) {
            const args = call?.function?.arguments;
            if (typeof args !== 'string') continue;
            const release = guard(index, `tool:${call.index ?? n}`, args, false);
            if (release === null) return false;
            call.function.arguments = release;
          }
        }
      }

      if (final) {
        const target = delta ?? (choice.delta = {});
        if (!flushChoiceInto(index, target)) return false;
      }

      const d = choice.delta;
      if (
        final ||
        (d && Object.keys(d).some((k) => k !== 'content' || d.content)) ||
        choice.logprobs != null
      ) {
        hasPayload = true;
      }
    }
    return hasPayload ? true : 'drop';
  };

  /** Flushes all remaining held text (end of stream / [DONE]). Returns false if the stream was cut. */
  const flushAll = (): boolean => {
    for (const choice of buffers.keys()) {
      const delta: any = {};
      if (!flushChoiceInto(choice, delta)) return false;
      if (Object.keys(delta).length === 0) continue;
      const chunk = {
        id: lastId || `cp-flush-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: lastModel,
        choices: [{ index: choice, delta, finish_reason: null }],
      };
      send(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    return true;
  };

  /** Handles one SSE line. Returns false once the stream has been cut. */
  const handleLine = async (rawLine: string): Promise<boolean> => {
    const line = rawLine.replace(/\r$/, '');
    const dataMatch = /^data:\s?(.*)$/.exec(line);
    if (!dataMatch) {
      // Blank line (event boundary), comment / keepalive, or event:/id:/retry: field
      send(`${line}\n`);
      return true;
    }

    const payload = dataMatch[1].trim();
    if (payload === '[DONE]') {
      if (!flushAll()) {
        await cutStream(violationReason!);
        return false;
      }
      send('data: [DONE]\n\n');
      return true;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(payload);
    } catch {
      if (failClosed) {
        await cutStream('Unparseable stream event under FAIL_CLOSED policy');
        return false;
      }
      // Not JSON: scan the raw payload as a whole before passing it through
      const violations = findStreamViolations(payload);
      if (violations.length > 0 && !redact) {
        await cutStream(violations[0].reason);
        return false;
      }
      let text = payload;
      for (const v of [...violations].reverse()) {
        redactedTypes.push(v.kind);
        text = text.slice(0, v.start) + `[REDACTED_${v.kind}]` + text.slice(v.end);
      }
      send(`data: ${text}\n`);
      return true;
    }

    if (!parsed || typeof parsed !== 'object') {
      send(`${line}\n`);
      return true;
    }
    if (typeof parsed.id === 'string') lastId = parsed.id;
    if (typeof parsed.model === 'string') lastModel = parsed.model;
    if (parsed.usage && typeof parsed.usage === 'object') upstreamUsage = parsed.usage;

    const outcome = guardChunk(parsed);
    if (outcome === false) {
      await cutStream(violationReason!);
      return false;
    }
    if (outcome === true) send(`data: ${JSON.stringify(parsed)}\n`);
    return true;
  };

  const decoder = new TextDecoder('utf-8');
  let sseBuffer = '';

  try {
    let open = true;
    while (open && !clientClosed) {
      const { done, value } = await reader.read();
      sseBuffer += done ? decoder.decode() : decoder.decode(value, { stream: true });

      // Process complete SSE lines; at end of stream the trailing partial line is a line too
      const lines = sseBuffer.split('\n');
      sseBuffer = done ? '' : lines.pop() || '';
      for (const line of lines) {
        if (done && line === '' && lines.length === 1) continue;
        if (!(await handleLine(line))) {
          open = false;
          break;
        }
      }
      if (done) break;
    }

    if (!hardViolation && !clientClosed) {
      if (!flushAll()) await cutStream(violationReason!);
    }
    if (!clientRes.writableEnded) clientRes.end();
  } catch (err) {
    console.error('[StreamInterceptor] Error while piping stream:', err);
    if (!clientRes.writableEnded) {
      send(`data: ${JSON.stringify({ error: 'Stream interrupted' })}\n\n`);
      clientRes.end();
    }
  } finally {
    clientRes.off?.('close', onClientClose);
  }

  const accumulatedText = choiceText.get(0) ?? '';
  const evaluatedText =
    choiceText.size > 1
      ? [...choiceText.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, t]) => t)
          .join('\n\n')
      : accumulatedText;

  const totalDuration = performance.now() - streamStart;
  const tokenEstimate = Math.ceil(evaluatedText.length / 4);
  // Prefer provider-reported usage (sent in the final chunk) over the char/4 estimate
  const promptTokens = upstreamUsage?.prompt_tokens ?? Math.ceil(userPrompt.length / 4);
  const completionTokens = upstreamUsage?.completion_tokens ?? tokenEstimate;
  const totalTokens = upstreamUsage?.total_tokens ?? promptTokens + completionTokens;

  // Background governance evaluation & session tracking (Tier 2/3)
  try {
    const postInteraction: SyntheticInteraction = {
      id: `stream-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      use_case: policy.use_case,
      session_id: ctx.sessionId,
      turn_number: turnNumber,
      query_type: 'streaming_completion',
      prompt: userPrompt,
      retrieved_context: null,
      response: evaluatedText,
      token_count: {
        prompt: promptTokens,
        completion: completionTokens,
        total: totalTokens,
      },
      latency_ms: Math.round(totalDuration),
      ground_truth_labels: hardViolation ? ['pii_leaking'] : ['clean'],
      metadata: {
        created_at: new Date().toISOString(),
        model_name: ctx.model,
      },
    };

    const postEval = evaluateInteraction(postInteraction, policy, sessionState, (u, q) =>
      globalBaselineTracker.getBaseline(u, q),
    );
    sessionState.events.push({
      risk: postEval.composite_risk_score,
      turnNumber,
      timestamp: Date.now(),
    });
    sessionState.currentRisk = postEval.composite_risk_score;

    // Persist to audit log & telemetry (bridges streaming gateway → audit trail)
    try {
      insertAuditLog(postInteraction, postEval, {
        tenant: { orgId: ctx.tenantOrgId, workspaceId: ctx.tenantWorkspaceId },
      });
      recordEvaluationTelemetry(
        postEval.verdict,
        postEval.use_case,
        postEval.responsibility.pii_detected.map((p) => p.type),
        postEval.performance.risk_score >= 0.4,
        postEval.has_multi_lane_overlap,
        postEval.added_overhead_latency_ms,
      );
    } catch (auditErr) {
      console.warn('[StreamInterceptor] Failed to persist audit/telemetry:', auditErr);
    }

    // Emit gateway event for Live Feed & Review Queue
    emitGatewayEvent({
      interaction: postInteraction,
      evaluation: postEval,
      tenantOrgId: ctx.tenantOrgId,
      tenantWorkspaceId: ctx.tenantWorkspaceId,
      policyProfile: ctx.policyKey,
      model: ctx.model,
      isStreaming: true,
      timestamp: new Date().toISOString(),
    });
  } catch (evalErr) {
    console.warn('[StreamInterceptor] Post-stream eval failed:', evalErr);
  }

  return {
    fullText: accumulatedText,
    tokenCountEstimate: tokenEstimate,
    hardViolationDetected: hardViolation,
    violationReason,
    redactedTypes,
    ttftMs: firstTokenTime ?? totalDuration,
    totalDurationMs: totalDuration,
  };
}
