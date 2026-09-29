/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Gateway — OpenAI-compatible Reverse Proxy Handler
 *
 * Implements POST /v1/chat/completions as a drop-in proxy that:
 * 1. Uses the authenticated principal (tenant, key-bound policy)
 * 2. Resolves the policy profile: a key's bound policy, or X-Policy-Profile for admins,
 *    local development and unbound keys
 * 3. Runs pre-flight input guards (prompt injection)
 * 4. Forwards to upstream LLM provider (guarded by a circuit breaker)
 * 5. Intercepts the response (streaming or non-streaming)
 * 6. Runs all 3 governance lanes inline
 * 7. Returns augmented response with governance metadata headers
 *
 * Circuit breaker semantics:
 * - OPEN + FAIL_CLOSED: 503, no upstream call.
 * - OPEN + FAIL_OPEN:   safe fallback completion, no upstream call.
 * - HALF_OPEN:          one bounded probe (requested model, single attempt).
 */

import crypto from 'crypto';
import type { Request, Response } from 'express';
import { evaluateInteraction } from '../lib/decisionEngine.js';
import { evaluateResponsibilityLane } from '../lib/lanes/responsibilityLane.js';
import {
  deliveryNote,
  inputGuardErrorMessage,
  WITHHELD_RESPONSE,
} from '../lib/deliveryTreatment.js';
import type {
  ConversationTurn,
  EvaluationResult,
  PolicyProfile,
  SyntheticInteraction,
  SessionState,
} from '../types.js';
import { scanInput, type InputGuardResult } from './inputGuard.js';
import { interceptStream } from './streamInterceptor.js';
import { CircuitBreaker } from './circuitBreaker.js';
import { calculateBackoffWithJitter, sleep } from './judge.js';
import { globalBaselineTracker } from './rollingBaseline.js';
import { insertAuditLog } from './db/database.js';
import { recordEvaluationTelemetry, recordCircuitBreakerTrip } from './telemetry.js';
import { tenantStampFor, type AuthenticatedRequest, type Principal } from './auth.js';
import { SCRIPTED_MODEL_NAME } from '../lib/gatewayScenarios.js';
import { upstreamProviderFor, type UpstreamProviderId } from '../lib/modelCatalog.js';
import { emitGatewayEvent, redactPiiSpans } from './gatewayEvents.js';

// ──────────────────────────────────────────────────────────────────────
// Upstream Provider Configuration
// ──────────────────────────────────────────────────────────────────────

export type { UpstreamProviderId };

interface UpstreamProvider {
  id: UpstreamProviderId;
  name: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  /** Ordered fallback models for this provider only (tried after the requested model). */
  fallbackModels: () => string[];
  /** Transient statuses worth retrying with backoff on the same model. */
  retryableStatuses: number[];
  /** Statuses meaning "this model is unavailable here" — skip to the next fallback. */
  modelUnavailableStatuses: number[];
}

function envModelList(envVar: string, defaults: string[] = []): string[] {
  const configured = (process.env[envVar] || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : defaults;
}

const UPSTREAM_PROVIDERS: Record<UpstreamProviderId, UpstreamProvider> = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    // Standard production models; avoids preview/lite variants.
    fallbackModels: () =>
      [
        process.env.GEMINI_MODEL,
        ...envModelList('GEMINI_FALLBACK_MODELS', [
          'gemini-3.6-flash',
          'gemini-flash-latest',
          'gemini-3.5-flash',
          'gemini-3.7-flash',
        ]),
      ].filter(Boolean) as string[],
    retryableStatuses: [429, 500, 503],
    modelUnavailableStatuses: [404],
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    fallbackModels: () => envModelList('OPENAI_FALLBACK_MODELS'),
    retryableStatuses: [429, 500, 502, 503],
    modelUnavailableStatuses: [404],
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    fallbackModels: () => envModelList('ANTHROPIC_FALLBACK_MODELS'),
    // 529 = Anthropic "overloaded"
    retryableStatuses: [429, 500, 503, 529],
    modelUnavailableStatuses: [404],
  },
  ollama: {
    id: 'ollama',
    name: 'Local Ollama (Qwen)',
    baseUrl: `${(process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '')}/v1`,
    apiKeyEnvVar: 'OLLAMA_API_KEY',
    fallbackModels: () => envModelList('OLLAMA_FALLBACK_MODELS'),
    retryableStatuses: [503],
    // Ollama returns 404 when the model has not been pulled.
    modelUnavailableStatuses: [404],
  },
};

/**
 * Resolves which upstream provider to use based on the model string.
 */
export function resolveUpstreamProvider(model: string): UpstreamProvider {
  return UPSTREAM_PROVIDERS[upstreamProviderFor(model)];
}

/**
 * Ordered candidate models: the requested model, then that provider's own
 * fallbacks. Fallbacks that would route to a different provider are dropped.
 */
export function buildModelCandidates(requestedModel: string): string[] {
  const provider = resolveUpstreamProvider(requestedModel);
  const candidates = [requestedModel];
  for (const m of provider.fallbackModels()) {
    if (!candidates.includes(m) && resolveUpstreamProvider(m).id === provider.id) {
      candidates.push(m);
    }
  }
  return candidates;
}

// ──────────────────────────────────────────────────────────────────────
// Session State Management
// ──────────────────────────────────────────────────────────────────────

const gatewaySessions: Record<string, SessionState> = {};
const MAX_SESSIONS = 5000;

function getSessionState(sessionKey: string): SessionState {
  if (!gatewaySessions[sessionKey]) {
    const keys = Object.keys(gatewaySessions);
    if (keys.length >= MAX_SESSIONS) {
      delete gatewaySessions[keys[0]];
    }
    gatewaySessions[sessionKey] = { events: [], currentRisk: 0 };
  }
  return gatewaySessions[sessionKey];
}

function updateSessionState(sessionKey: string, risk: number, turnNumber: number): void {
  const session = getSessionState(sessionKey);
  session.events.push({
    risk,
    turnNumber,
    timestamp: Date.now(),
  });
  session.currentRisk = risk;
}

function newInteractionId(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

// ──────────────────────────────────────────────────────────────────────
// Circuit Breaker Instance
// ──────────────────────────────────────────────────────────────────────

const upstreamBreaker = new CircuitBreaker({
  failureThreshold: 5,
  recoveryTimeoutMs: 30000,
  halfOpenMaxAttempts: 2,
  onTrip: () => {
    recordCircuitBreakerTrip();
    console.warn('[Gateway] Upstream circuit breaker tripped OPEN');
  },
});

/** Exposed for tests and operational tooling. */
export function getUpstreamBreaker(): CircuitBreaker {
  return upstreamBreaker;
}

// ──────────────────────────────────────────────────────────────────────
// Baseline learning
// ──────────────────────────────────────────────────────────────────────

/**
 * Feeds a scored interaction into the rolling baseline — but only when the
 * request was fully trusted (ALLOW and not itself a cost outlier). Must be
 * called AFTER the interaction has been scored against the current baseline.
 */
export function learnFromTrustedObservation(
  interaction: SyntheticInteraction,
  evaluation: EvaluationResult,
): boolean {
  if (evaluation.verdict !== 'ALLOW' || evaluation.cost.is_outlier) return false;
  if (!(interaction.token_count.total > 0)) return false;
  try {
    globalBaselineTracker.recordObservation(
      interaction.use_case,
      interaction.query_type,
      interaction.token_count.total,
      interaction.latency_ms,
    );
    return true;
  } catch (err) {
    console.warn('[Gateway] Rejected baseline observation:', (err as Error).message);
    return false;
  }
}

function safeFallbackCompletion(reason: string, modelsAttempted: string[]) {
  return {
    id: `chatcmpl-fallback-${Date.now()}`,
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content:
            "I apologize, but I'm unable to process your request at this time. Please try again shortly.",
        },
        finish_reason: 'content_filter',
      },
    ],
    governance: {
      mode: 'FAIL_OPEN',
      reason,
      models_attempted: modelsAttempted,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────
// Response & error shaping (OpenAI wire compatibility)
// ──────────────────────────────────────────────────────────────────────

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Arguments of every tool call (and the legacy function_call) in a choice's message. */
function toolArgumentsOf(choice: any): string[] {
  const message = choice?.message;
  const toolArgs = Array.isArray(message?.tool_calls)
    ? message.tool_calls.map((tc: any) => tc?.function?.arguments)
    : [];
  return [...toolArgs, message?.function_call?.arguments].filter(isNonEmptyString);
}

/** Redacts PII in one text field; returns it unchanged when nothing is found. */
function redactPiiText(text: string, policy: PolicyProfile): string {
  const scan = evaluateResponsibilityLane(
    text,
    policy.geography_ruleset,
    policy.thresholds.pii_severity_cutoff,
    policy.thresholds.toxicity_cutoff,
  );
  return scan.pii_detected.length > 0 ? scan.redacted_response : text;
}

/**
 * Applies governance to one upstream choice without dropping any of its fields:
 * PII is redacted in content and tool/function-call arguments, and the delivery
 * note (accuracy warning or verification note) is appended to non-empty content.
 */
function governChoice(choice: any, policy: PolicyProfile, note: string | null): any {
  const message = choice?.message;
  if (!message || typeof message !== 'object') return choice;

  const governed: any = { ...message };
  if (typeof governed.content === 'string') {
    governed.content = redactPiiText(governed.content, policy);
    if (note && governed.content) governed.content += note;
  }
  if (Array.isArray(governed.tool_calls)) {
    governed.tool_calls = governed.tool_calls.map((tc: any) =>
      typeof tc?.function?.arguments === 'string'
        ? {
            ...tc,
            function: { ...tc.function, arguments: redactPiiText(tc.function.arguments, policy) },
          }
        : tc,
    );
  }
  if (typeof governed.function_call?.arguments === 'string') {
    governed.function_call = {
      ...governed.function_call,
      arguments: redactPiiText(governed.function_call.arguments, policy),
    };
  }
  return { ...choice, message: governed };
}

/**
 * Returns an upstream error body in OpenAI shape ({ error: { message, type, param, code } })
 * so SDK clients can branch on it, or null when the body is not a structured error.
 * Gemini's OpenAI endpoint wraps errors in a one-element array; Anthropic's carries the
 * same `error` object.
 */
export function upstreamErrorBody(rawBody: string): { error: Record<string, unknown> } | null {
  try {
    let parsed = JSON.parse(rawBody);
    if (Array.isArray(parsed)) parsed = parsed[0];
    const error = parsed?.error;
    if (error && typeof error === 'object' && typeof error.message === 'string') {
      return { error };
    }
  } catch {
    // Not JSON
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────
// Grounding context from the request
// ──────────────────────────────────────────────────────────────────────

/**
 * System/developer messages shorter than this are treated as instructions only
 * ("You are a helpful assistant"): they hold nothing to check an answer against,
 * and grounding general answers against them would flag every one as unsupported.
 */
export const MIN_SYSTEM_CONTEXT_CHARS = 200;

/** Header carrying retrieved documents explicitly, base64-encoded UTF-8. */
export const CONTEXT_HEADER = 'x-controlplane-context';

/** Plain text of a chat message's content (string or content-part array). */
export function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p: any) => (typeof p === 'string' ? p : typeof p?.text === 'string' ? p.text : ''))
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

export interface RequestGrounding {
  lastUserMessage: string;
  systemPrompt?: string;
  /** Evidence the answer is checked against; null when the request carries none. */
  retrievedContext: string | null;
  /** Earlier user/assistant turns (the last user message excluded). */
  history: ConversationTurn[];
}

/**
 * Splits an OpenAI-style request into what governance needs. Only content the
 * calling application supplies counts as evidence: system/developer messages and
 * the context header. User messages never do, so a user cannot "ground" a false
 * claim by asserting it.
 */
export function extractRequestGrounding(
  messages: any[],
  contextHeader?: string | string[],
): RequestGrounding {
  const list = Array.isArray(messages) ? messages : [];
  const systemPrompt =
    list
      .filter((m) => m?.role === 'system' || m?.role === 'developer')
      .map((m) => messageText(m.content))
      .filter(Boolean)
      .join('\n\n') || undefined;

  let lastUserIndex = -1;
  list.forEach((m, i) => {
    if (m?.role === 'user') lastUserIndex = i;
  });
  const lastUserMessage = lastUserIndex >= 0 ? messageText(list[lastUserIndex].content) : '';
  const history: ConversationTurn[] = list
    .slice(0, Math.max(lastUserIndex, 0))
    .filter((m) => m?.role === 'user' || m?.role === 'assistant')
    .map((m) => ({ role: m.role, content: messageText(m.content) }))
    .filter((t) => t.content);

  const rawHeader = Array.isArray(contextHeader) ? contextHeader[0] : contextHeader;
  let headerContext = '';
  if (rawHeader) {
    try {
      headerContext = Buffer.from(rawHeader, 'base64').toString('utf8').trim();
    } catch {
      headerContext = '';
    }
  }

  // A RAG app usually puts its documents in the system message and may also declare
  // them in the header: count them once. What remains of the system message is then
  // evidence only if it is still substantial, like any system message.
  const systemEvidence =
    headerContext && systemPrompt?.includes(headerContext)
      ? systemPrompt.replace(headerContext, '').trim()
      : (systemPrompt ?? '');
  const evidence = [
    headerContext,
    systemEvidence.length >= MIN_SYSTEM_CONTEXT_CHARS ? systemEvidence : '',
  ].filter(Boolean);

  return {
    lastUserMessage,
    systemPrompt,
    retrievedContext: evidence.length > 0 ? evidence.join('\n\n') : null,
    history,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Input guard blocks
// ──────────────────────────────────────────────────────────────────────

interface InputGuardBlock {
  inputGuard: InputGuardResult;
  grounding: RequestGrounding;
  policy: PolicyProfile;
  policyKey: string;
  tenant: { orgId: string; workspaceId: string };
  model: string;
  isStreaming: boolean;
  sessionId: string;
  turnNumber: number;
  queryType: string;
}

/**
 * Turns a rejected prompt into a governed record: an audit entry, telemetry, a
 * live event and a review-queue escalation, plus session risk (repeated attempts
 * add up). The model was never called, so there is no response to evaluate; the
 * guard's finding is attached instead, without the matched text (it may be PII).
 */
export function recordInputGuardBlock(block: InputGuardBlock): EvaluationResult {
  const { inputGuard, grounding, policy, policyKey, tenant, model, sessionId, turnNumber } = block;
  const interaction: SyntheticInteraction = {
    id: newInteractionId('guard'),
    use_case: policy.use_case,
    session_id: sessionId,
    turn_number: turnNumber,
    query_type: block.queryType,
    prompt: grounding.lastUserMessage,
    system_prompt: grounding.systemPrompt,
    history: grounding.history,
    retrieved_context: grounding.retrievedContext,
    response: '',
    token_count: { prompt: 0, completion: 0, total: 0 },
    latency_ms: 0,
    ground_truth_labels: ['clean'],
    metadata: { created_at: new Date().toISOString(), model_name: model },
  };

  const sessionKey = `${tenant.orgId}:${tenant.workspaceId}:${sessionId}`;
  const scored = evaluateInteraction(interaction, policy, getSessionState(sessionKey));
  const rules = (inputGuard.details ?? []).map((d) => d.name || d.category);
  const evaluation: EvaluationResult = {
    ...scored,
    composite_risk_score: Math.max(scored.composite_risk_score, inputGuard.riskScore),
    verdict: 'BLOCK_ESCALATE',
    is_pre_response_blocked: true,
    is_flagged_for_review: true,
    overlapping_lanes: [`Input Guard (${rules[0] ?? 'Blocked'})`],
    has_multi_lane_overlap: false,
    input_guard: {
      reason: inputGuard.reason || 'Blocked',
      risk_score: inputGuard.riskScore,
      detections: inputGuard.detections,
      rules,
    },
  };
  updateSessionState(sessionKey, evaluation.composite_risk_score, turnNumber);

  try {
    insertAuditLog(interaction, evaluation, { tenant });
    recordEvaluationTelemetry(
      evaluation.verdict,
      evaluation.use_case,
      [],
      false,
      false,
      evaluation.added_overhead_latency_ms,
    );
  } catch (err) {
    console.warn('[Gateway] Failed to persist audit/telemetry for input-guard block:', err);
  }

  emitGatewayEvent({
    interaction,
    evaluation,
    tenantOrgId: tenant.orgId,
    tenantWorkspaceId: tenant.workspaceId,
    policyProfile: policyKey,
    model,
    isStreaming: block.isStreaming,
    timestamp: new Date().toISOString(),
  });
  return evaluation;
}

// ──────────────────────────────────────────────────────────────────────
// Model listing (GET /v1/models)
// ──────────────────────────────────────────────────────────────────────

/** API key for a provider; local Ollama needs none. Empty when the provider is not configured. */
function providerApiKey(provider: UpstreamProvider): string {
  return process.env[provider.apiKeyEnvVar] || (provider.id === 'ollama' ? 'ollama-local-key' : '');
}

export interface GatewayModel {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

const MODEL_LIST_TTL_MS = 5 * 60_000;
const MODEL_LIST_TIMEOUT_MS = 3000;
let modelListCache: { at: number; data: GatewayModel[] } | null = null;

/** Clears the cached model list (tests, key rotation). */
export function resetModelListCache(): void {
  modelListCache = null;
}

/** Asks one provider for its models; returns null when it cannot be reached. */
async function fetchProviderModels(provider: UpstreamProvider, apiKey: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (provider.id === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  }
  try {
    const resp = await fetch(`${provider.baseUrl}/models`, {
      headers,
      signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const body: any = await resp.json();
    return Array.isArray(body?.data) ? (body.data as any[]) : null;
  } catch {
    return null;
  }
}

/**
 * Models the gateway can serve: for every provider with a key configured, the models
 * it reports plus its configured fallbacks. Only ids the gateway would route back to
 * the same provider are listed, so every listed model works when requested.
 */
export async function listGatewayModels(): Promise<GatewayModel[]> {
  if (modelListCache && Date.now() - modelListCache.at < MODEL_LIST_TTL_MS) {
    return modelListCache.data;
  }

  const configured = Object.values(UPSTREAM_PROVIDERS).filter((p) => providerApiKey(p));
  const perProvider = await Promise.all(
    configured.map(async (provider) => {
      const reported = (await fetchProviderModels(provider, providerApiKey(provider))) ?? [];
      const entries: GatewayModel[] = [
        ...reported
          .filter((m) => typeof m?.id === 'string')
          .map((m) => ({
            id: m.id as string,
            object: 'model' as const,
            created: typeof m.created === 'number' ? m.created : 0,
            owned_by: typeof m.owned_by === 'string' ? m.owned_by : provider.id,
          })),
        ...provider.fallbackModels().map((id) => ({
          id,
          object: 'model' as const,
          created: 0,
          owned_by: provider.id,
        })),
      ];
      return entries.filter((m) => resolveUpstreamProvider(m.id).id === provider.id);
    }),
  );

  const seen = new Set<string>();
  const data = perProvider.flat().filter((m) => !seen.has(m.id) && seen.add(m.id));
  modelListCache = { at: Date.now(), data };
  return data;
}

/** GET /v1/models */
export async function handleListModels(_req: Request, res: Response): Promise<void> {
  try {
    res.json({ object: 'list', data: await listGatewayModels() });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message || 'Failed to list models', type: 'internal_error' },
    });
  }
}

/** GET /v1/models/:model */
export async function handleRetrieveModel(req: Request, res: Response): Promise<void> {
  const id = req.params.model;
  const model = (await listGatewayModels()).find((m) => m.id === id);
  if (!model) {
    res.status(404).json({
      error: {
        message: `The model '${id}' does not exist or is not available through this gateway`,
        type: 'invalid_request_error',
        param: 'model',
        code: 'model_not_found',
      },
    });
    return;
  }
  res.json(model);
}

// ──────────────────────────────────────────────────────────────────────
// Request options: workload tag and scripted responses
// ──────────────────────────────────────────────────────────────────────

/** Header naming the request's workload (its cost-lane baseline), e.g. "refund_policy". */
export const WORKLOAD_HEADER = 'x-controlplane-workload';

/** Workload from the request header; untagged traffic shares one gateway baseline. */
export function workloadFromHeader(value: string | string[] | undefined): string {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase() ?? '';
  return /^[a-z0-9_]{1,64}$/.test(raw) ? raw : 'gateway_request';
}

export interface ScriptedResponse {
  text: string;
  /** Total tokens to report (prompt + completion); estimated from the text when absent. */
  totalTokens?: number;
  /** Latency to record for the cost lane; the measured time when absent. */
  latencyMs?: number;
}

/**
 * A scripted response (request body `controlplane.scripted_response`) supplies the
 * model's answer: the gateway governs it exactly like a real one, but no model is
 * called. The Gateway Playground uses it for repeatable demos. It is recorded as
 * model "scripted-response" and never used to learn cost baselines.
 */
export function parseScriptedResponse(extension: unknown): ScriptedResponse | null {
  if (!extension || typeof extension !== 'object') return null;
  const ext = extension as Record<string, unknown>;
  if (typeof ext.scripted_response !== 'string' || !ext.scripted_response.trim()) return null;
  const count = (value: unknown) => {
    const n = Number(value);
    return value !== undefined && value !== null && Number.isFinite(n) && n >= 0
      ? Math.round(n)
      : undefined;
  };
  return {
    text: ext.scripted_response,
    totalTokens: count(ext.total_tokens),
    latencyMs: count(ext.latency_ms),
  };
}

/** Only local development and admins may put model output of their own into the audit trail. */
function canUseScriptedResponses(principal: Principal | undefined): boolean {
  return !principal || principal.kind === 'local_dev' || principal.role === 'admin';
}

/** Delay between scripted stream chunks, so a scripted stream looks like live tokens. */
const SCRIPTED_STREAM_CHUNK_MS = 15;

/** An OpenAI-shaped upstream response (JSON or SSE) carrying the scripted answer. */
function scriptedUpstreamResponse(
  scripted: ScriptedResponse,
  promptText: string,
  model: string,
  stream: boolean,
): globalThis.Response {
  const promptTokens = Math.ceil(promptText.length / 4);
  const completionTokens =
    scripted.totalTokens !== undefined && scripted.totalTokens > promptTokens
      ? scripted.totalTokens - promptTokens
      : Math.ceil(scripted.text.length / 4);
  const usage = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
  const id = `chatcmpl-scripted-${crypto.randomBytes(4).toString('hex')}`;
  const created = Math.floor(Date.now() / 1000);

  if (!stream) {
    return new Response(
      JSON.stringify({
        id,
        object: 'chat.completion',
        created,
        model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: scripted.text },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Sent in small pieces, like tokens, so the stream interceptor handles a real stream
  const encoder = new TextEncoder();
  const event = (payload: unknown) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
  const chunk = (delta: Record<string, unknown>, finishReason: string | null = null) =>
    event({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    });
  let cancelled = false;
  return new Response(
    new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(chunk({ role: 'assistant' }));
          for (const piece of scripted.text.match(/[\s\S]{1,12}/g) ?? []) {
            if (cancelled) return;
            controller.enqueue(chunk({ content: piece }));
            await sleep(SCRIPTED_STREAM_CHUNK_MS);
          }
          if (cancelled) return;
          controller.enqueue(chunk({}, 'stop'));
          controller.enqueue(
            event({ id, object: 'chat.completion.chunk', created, model, choices: [], usage }),
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch {
          // The interceptor cancelled the stream (e.g. it cut it on a violation)
        }
      },
      cancel() {
        cancelled = true;
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

/**
 * Calls the upstream provider with provider-scoped model fallback, exponential
 * backoff and the circuit breaker. Returns the response and the model that served
 * it, or null when an error response has already been sent to the client.
 */
async function forwardToUpstream(
  forwardBody: Record<string, unknown>,
  requestedModel: string,
  isStreaming: boolean,
  policy: PolicyProfile,
  res: Response,
): Promise<{ response: globalThis.Response; model: string } | null> {
  const provider = resolveUpstreamProvider(requestedModel);
  const apiKey = providerApiKey(provider);
  if (!apiKey) {
    res.status(500).json({
      error: {
        message: `No API key configured for ${provider.name} (env: ${provider.apiKeyEnvVar})`,
        type: 'configuration_error',
      },
    });
    return null;
  }

  // Circuit breaker check
  const failMode = policy.failMode || 'FAIL_OPEN';
  if (!upstreamBreaker.canRequest()) {
    if (failMode === 'FAIL_CLOSED') {
      res.status(503).json({
        error: {
          message: 'Upstream LLM provider circuit breaker OPEN. Service temporarily unavailable.',
          type: 'service_unavailable',
          code: 'circuit_breaker_open',
        },
      });
      return null;
    }
    // FAIL_OPEN: serve a safe fallback without touching the failed upstream.
    console.warn('[Gateway] Circuit breaker OPEN — FAIL_OPEN mode, serving safe fallback');
    res.status(200).json(safeFallbackCompletion('Upstream circuit breaker open', []));
    return null;
  }

  // A HALF_OPEN breaker grants one bounded probe: requested model, one attempt.
  const isProbe = upstreamBreaker.isProbing();
  const modelsToTry = isProbe ? [requestedModel] : buildModelCandidates(requestedModel);
  const MAX_RETRIES_PER_MODEL = isProbe ? 1 : 3;

  // Forward to upstream with provider-scoped model fallback & exponential backoff
  const upstreamUrl = `${provider.baseUrl}/chat/completions`;
  const upstreamHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  let upstreamResponse: globalThis.Response | null = null;
  let usedModel = requestedModel;
  let lastError = '';

  for (const candidateModel of modelsToTry) {
    let candidateResolved = false;

    for (let attempt = 0; attempt < MAX_RETRIES_PER_MODEL; attempt++) {
      try {
        const upstreamBody = {
          ...forwardBody,
          model: candidateModel,
          stream: isStreaming,
        };

        const resp = await fetch(upstreamUrl, {
          method: 'POST',
          headers: upstreamHeaders,
          body: JSON.stringify(upstreamBody),
        });

        if (resp.ok) {
          upstreamResponse = resp;
          usedModel = candidateModel;
          upstreamBreaker.recordSuccess();
          if (candidateModel !== requestedModel) {
            console.log(
              `[Gateway] Model fallback: ${requestedModel} → ${candidateModel} (success)`,
            );
          }
          candidateResolved = true;
          break;
        }

        // Transient provider errors: retry with backoff, then move to the next model
        if (provider.retryableStatuses.includes(resp.status)) {
          const errText = await resp.text();
          lastError = errText;
          if (attempt < MAX_RETRIES_PER_MODEL - 1) {
            const delayMs = calculateBackoffWithJitter(attempt, 2000, 16000, 500);
            console.warn(
              `[Gateway] ${provider.name} model ${candidateModel} returned ${resp.status}. Backing off for ${delayMs}ms with jitter (attempt ${attempt + 1}/${MAX_RETRIES_PER_MODEL})...`,
            );
            await sleep(delayMs);
            continue;
          } else {
            console.warn(
              `[Gateway] ${provider.name} model ${candidateModel} retries exhausted (${resp.status}), advancing to next model tier...`,
            );
            if (!isProbe) await sleep(1000);
            break;
          }
        }

        // Model not available on this provider — skip candidate without retries
        if (provider.modelUnavailableStatuses.includes(resp.status)) {
          const errText = await resp.text();
          lastError = errText;
          console.warn(
            `[Gateway] ${provider.name} model ${candidateModel} returned ${resp.status} (unavailable), skipping to next tier...`,
          );
          break;
        }

        // Non-retryable error — return immediately. Only upstream-side (5xx)
        // failures count against the breaker; a 4xx proves the provider is reachable.
        const errorBody = await resp.text();
        if (resp.status >= 500) {
          upstreamBreaker.recordFailure();
        } else {
          upstreamBreaker.recordSuccess();
        }
        res.status(resp.status).json(
          upstreamErrorBody(errorBody) ?? {
            error: {
              message: `Upstream error: ${errorBody}`,
              type: 'upstream_error',
            },
          },
        );
        return null;
      } catch (err: any) {
        lastError = err.message;
        if (attempt < MAX_RETRIES_PER_MODEL - 1) {
          const delayMs = calculateBackoffWithJitter(attempt, 2000, 16000, 500);
          console.warn(
            `[Gateway] Model ${candidateModel} network error: ${err.message}. Retrying in ${delayMs}ms...`,
          );
          await sleep(delayMs);
        } else {
          console.warn(
            `[Gateway] Model ${candidateModel} network retries exhausted: ${err.message}, trying next...`,
          );
          if (!isProbe) await sleep(1000);
          break;
        }
      }
    }

    if (candidateResolved) {
      break;
    }
  }

  // All models exhausted
  if (!upstreamResponse) {
    upstreamBreaker.recordFailure();
    if (failMode === 'FAIL_CLOSED') {
      res.status(502).json({
        error: {
          message: `All upstream models unavailable. Last error: ${lastError}`,
          type: 'upstream_error',
        },
      });
      return null;
    }
    // FAIL_OPEN: return a safe fallback
    res.status(200).json(safeFallbackCompletion('All upstream models unavailable', modelsToTry));
    return null;
  }

  return { response: upstreamResponse, model: usedModel };
}

// ──────────────────────────────────────────────────────────────────────
// Main Gateway Handler
// ──────────────────────────────────────────────────────────────────────

export async function handleChatCompletions(
  req: Request | AuthenticatedRequest,
  res: Response,
  policyProfiles: Record<string, PolicyProfile>,
): Promise<void> {
  const startTime = performance.now();

  try {
    const body = req.body;
    const model = body.model || 'gemini-3.6-flash';
    const isStreaming = body.stream === true;
    const messages = body.messages || [];
    // Gateway options travel in `controlplane`; they are never forwarded to the provider
    const { controlplane: gatewayOptions, ...forwardBody } = body;

    // ── 1. Resolve tenant, policy profile, session and workload ──
    // A key's bound policy wins over the header, so a service key cannot pick a laxer
    // policy. Admins and local development may choose any policy per request (they can
    // edit policies anyway), e.g. from the Gateway Playground.
    const authReq = req as AuthenticatedRequest;
    const headerPolicy = req.headers['x-policy-profile'] as string | undefined;
    const principal = authReq.principal;
    const mayChoosePolicy =
      !principal || principal.kind === 'local_dev' || principal.role === 'admin';
    const policyKey =
      (mayChoosePolicy && headerPolicy) || authReq.resolvedPolicy || headerPolicy || 'support_bot';
    const tenant = authReq.principal
      ? tenantStampFor(authReq.principal)
      : {
          orgId: authReq.orgId || 'anonymous',
          workspaceId: authReq.workspaceId || 'default',
        };
    const policy = Object.hasOwn(policyProfiles, policyKey) ? policyProfiles[policyKey] : undefined;
    if (!policy) {
      res.status(400).json({
        error: {
          message: `Unknown policy profile: ${policyKey}`,
          type: 'invalid_request_error',
        },
      });
      return;
    }
    const sessionId = (req.headers['x-session-id'] as string) || newInteractionId('anon');
    const sessionKey = `${tenant.orgId}:${tenant.workspaceId}:${sessionId}`;
    const turnNumber = parseInt((req.headers['x-turn-number'] as string) || '1', 10) || 1;
    const queryType = workloadFromHeader(req.headers[WORKLOAD_HEADER]);

    // ── 2. Pre-flight input guard (safely handling string or multimodal parts) ──
    // Per-key rate limiting already happened in the auth middleware.
    const grounding = extractRequestGrounding(messages, req.headers[CONTEXT_HEADER]);
    const { lastUserMessage } = grounding;

    const inputGuard: InputGuardResult = scanInput(lastUserMessage);
    if (!inputGuard.pass) {
      // Recorded like any governed interaction, so the attempt is audited and visible
      const blocked = recordInputGuardBlock({
        inputGuard,
        grounding,
        policy,
        policyKey,
        tenant,
        model,
        isStreaming,
        sessionId,
        turnNumber,
        queryType,
      });
      res.set({
        'X-ControlPlane-Interaction-Id': blocked.interaction_id,
        'X-ControlPlane-Verdict': blocked.verdict,
        'X-ControlPlane-Policy': policyKey,
      });
      res.status(400).json({
        error: {
          message: inputGuardErrorMessage(inputGuard.reason || 'Blocked'),
          type: 'content_filter_error',
          code: 'input_guard_violation',
        },
        governance: {
          input_risk_score: inputGuard.riskScore,
          reason: inputGuard.reason,
          detections: inputGuard.detections,
        },
      });
      return;
    }

    // ── 3. The model's response: from the real upstream, or scripted by the tester ──
    const scripted = parseScriptedResponse(gatewayOptions);
    let upstream: { response: globalThis.Response; model: string } | null;
    if (scripted) {
      if (!canUseScriptedResponses(authReq.principal)) {
        res.status(403).json({
          error: {
            message: 'Scripted responses require local dev mode or an admin API key.',
            type: 'permission_error',
            code: 'scripted_response_forbidden',
          },
        });
        return;
      }
      upstream = {
        response: scriptedUpstreamResponse(
          scripted,
          [grounding.systemPrompt, lastUserMessage].filter(Boolean).join('\n'),
          model,
          isStreaming,
        ),
        model: SCRIPTED_MODEL_NAME,
      };
    } else {
      upstream = await forwardToUpstream(forwardBody, model, isStreaming, policy, res);
      if (!upstream) return;
    }
    const { response: upstreamResponse, model: usedModel } = upstream;
    const responseSource = scripted ? 'scripted' : 'model';

    // ── 4. Streaming: the stream interceptor records audit, telemetry and the gateway event ──
    if (isStreaming) {
      const sessionState = getSessionState(sessionKey);
      await interceptStream(
        upstreamResponse,
        res,
        policy,
        lastUserMessage,
        sessionState,
        turnNumber,
        {
          tenantOrgId: tenant.orgId,
          tenantWorkspaceId: tenant.workspaceId,
          sessionId,
          model: usedModel,
          policyKey,
          systemPrompt: grounding.systemPrompt,
          history: grounding.history,
          retrievedContext: grounding.retrievedContext,
          interactionId: newInteractionId('stream'),
          queryType,
          latencyMs: scripted?.latencyMs,
          responseSource,
        },
      );
      return;
    }

    // ── 5. Non-streaming: full response evaluation ──
    let upstreamData: any;
    try {
      upstreamData = await upstreamResponse.json();
    } catch {
      res.status(502).json({
        error: {
          message: 'Upstream returned invalid non-JSON payload',
          type: 'upstream_error',
        },
      });
      return;
    }

    // Governance sees every choice's text and every tool/function call argument
    const upstreamChoices: any[] = Array.isArray(upstreamData.choices) ? upstreamData.choices : [];
    const assistantMessage = [
      ...upstreamChoices.map((c) => c?.message?.content).filter(isNonEmptyString),
      ...upstreamChoices.flatMap(toolArgumentsOf),
    ].join('\n\n');

    // Build a SyntheticInteraction object for the evaluator
    const interaction: SyntheticInteraction = {
      id: newInteractionId('gw'),
      use_case: policy.use_case,
      session_id: sessionId,
      turn_number: turnNumber,
      query_type: queryType,
      prompt: lastUserMessage,
      system_prompt: grounding.systemPrompt,
      history: grounding.history,
      retrieved_context: grounding.retrievedContext,
      response: assistantMessage,
      token_count: {
        prompt: upstreamData.usage?.prompt_tokens || 0,
        completion: upstreamData.usage?.completion_tokens || 0,
        total: upstreamData.usage?.total_tokens || 0,
      },
      latency_ms: scripted?.latencyMs ?? Math.round(performance.now() - startTime),
      ground_truth_labels: ['clean'],
      metadata: {
        created_at: new Date().toISOString(),
        model_name: usedModel,
      },
    };

    const sessionState = getSessionState(sessionKey);
    const evaluation = evaluateInteraction(interaction, policy, sessionState, (u, q) =>
      globalBaselineTracker.getBaseline(u, q),
    );

    // Learn only from trusted, real traffic, and only after scoring
    if (!scripted) learnFromTrustedObservation(interaction, evaluation);

    // Update session state
    updateSessionState(sessionKey, evaluation.composite_risk_score, turnNumber);

    // ── Persist to audit log & telemetry (bridges gateway → audit trail) ──
    try {
      insertAuditLog(interaction, evaluation, { tenant });
      recordEvaluationTelemetry(
        evaluation.verdict,
        evaluation.use_case,
        evaluation.responsibility.pii_detected.map((p) => p.type),
        evaluation.performance.risk_score >= 0.4,
        evaluation.has_multi_lane_overlap,
        evaluation.added_overhead_latency_ms,
      );
    } catch (auditErr) {
      console.warn('[Gateway] Failed to persist audit/telemetry for gateway request:', auditErr);
    }

    // ── Emit gateway event for Live Feed & Review Queue ──
    emitGatewayEvent({
      interaction,
      evaluation,
      tenantOrgId: tenant.orgId,
      tenantWorkspaceId: tenant.workspaceId,
      policyProfile: policyKey,
      model: usedModel,
      isStreaming: false,
      timestamp: new Date().toISOString(),
    });

    // Set governance headers on all evaluated responses
    res.set({
      'X-ControlPlane-Verdict': evaluation.verdict,
      'X-ControlPlane-Risk-Score': evaluation.composite_risk_score.toString(),
      'X-ControlPlane-Session-Risk': evaluation.session_accumulated_risk.toString(),
      'X-ControlPlane-Policy-Version': policy.version,
      'X-ControlPlane-Latency-Ms': Math.round(performance.now() - startTime).toString(),
      'X-ControlPlane-Tenant': tenant.orgId,
      'X-ControlPlane-Interaction-Id': interaction.id,
      'X-ControlPlane-Response-Source': responseSource,
      'X-ControlPlane-Policy': policyKey,
    });

    // ── 6. Apply verdict ──
    if (evaluation.verdict === 'BLOCK_ESCALATE' && policy.pre_response_blocking) {
      const withheld = (index: number) => ({
        index,
        message: {
          role: 'assistant',
          content: WITHHELD_RESPONSE,
        },
        finish_reason: 'content_filter',
        logprobs: null,
      });
      res.status(200).json({
        ...upstreamData,
        choices:
          upstreamChoices.length > 0
            ? upstreamChoices.map((c, i) => withheld(typeof c?.index === 'number' ? c.index : i))
            : [withheld(0)],
        governance: {
          verdict: evaluation.verdict,
          composite_risk_score: evaluation.composite_risk_score,
          performance_risk: evaluation.performance.risk_score,
          responsibility_risk: evaluation.responsibility.risk_score,
          cost_risk: evaluation.cost.risk_score,
          overlapping_lanes: evaluation.overlapping_lanes,
          // The response was withheld, so the metadata must not echo the PII back
          triggering_spans: [
            ...evaluation.performance.triggering_spans,
            ...redactPiiSpans(evaluation.responsibility),
          ],
          policy_violations: evaluation.responsibility.policy_violations,
          added_latency_ms: Math.round(performance.now() - startTime),
        },
      });
      return;
    }

    const note = deliveryNote(evaluation);

    // Keep the upstream response intact (all choices, tool calls, refusal, annotations,
    // logprobs); only redact PII in text and tool arguments and append the delivery note
    res.json({
      ...upstreamData,
      choices: upstreamChoices.map((choice) => governChoice(choice, policy, note)),
      governance: {
        verdict: evaluation.verdict,
        composite_risk_score: evaluation.composite_risk_score,
        session_risk: evaluation.session_accumulated_risk,
        has_multi_lane_overlap: evaluation.has_multi_lane_overlap,
        added_latency_ms: Math.round(performance.now() - startTime),
      },
    });
  } catch (error: any) {
    console.error('[Gateway] Unhandled error:', error);
    res.status(500).json({
      error: {
        message: error.message || 'Internal gateway error',
        type: 'internal_error',
      },
    });
  }
}
