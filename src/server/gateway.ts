/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Gateway — OpenAI-compatible Reverse Proxy Handler
 *
 * Implements POST /v1/chat/completions as a drop-in proxy that:
 * 1. Uses the authenticated principal (tenant, key-bound policy)
 * 2. Resolves the policy profile from the API key or headers
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
import type {
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
import { tenantStampFor, type AuthenticatedRequest } from './auth.js';
import { emitGatewayEvent, redactPiiSpans } from './gatewayEvents.js';

// ──────────────────────────────────────────────────────────────────────
// Upstream Provider Configuration
// ──────────────────────────────────────────────────────────────────────

export type UpstreamProviderId = 'gemini' | 'openai' | 'anthropic' | 'ollama';

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
  const modelLower = model.toLowerCase();
  if (modelLower.includes('qwen') || modelLower.includes('ollama')) {
    return UPSTREAM_PROVIDERS.ollama;
  }
  if (modelLower.includes('gemini') || modelLower.includes('models/')) {
    return UPSTREAM_PROVIDERS.gemini;
  }
  if (modelLower.includes('claude') || modelLower.includes('anthropic')) {
    return UPSTREAM_PROVIDERS.anthropic;
  }
  // Default to OpenAI for gpt-* models or unknown
  return UPSTREAM_PROVIDERS.openai;
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

    // ── 1. Resolve tenant & policy profile ──
    // Prefer tenant-bound policy from authenticated API key, then header, then default
    const authReq = req as AuthenticatedRequest;
    const policyKey =
      authReq.resolvedPolicy || (req.headers['x-policy-profile'] as string) || 'support_bot';
    const tenant = authReq.principal
      ? tenantStampFor(authReq.principal)
      : {
          orgId: authReq.orgId || 'anonymous',
          workspaceId: authReq.workspaceId || 'default',
        };
    const policy = policyProfiles[policyKey];
    if (!policy) {
      res.status(400).json({
        error: {
          message: `Unknown policy profile: ${policyKey}`,
          type: 'invalid_request_error',
        },
      });
      return;
    }

    // ── 2. Pre-flight input guard (safely handling string or multimodal parts) ──
    // Per-key rate limiting already happened in the auth middleware.
    const rawUserContent = messages.filter((m: any) => m.role === 'user').pop()?.content || '';
    const lastUserMessage =
      typeof rawUserContent === 'string'
        ? rawUserContent
        : Array.isArray(rawUserContent)
          ? rawUserContent.map((p: any) => (typeof p === 'string' ? p : p?.text || '')).join(' ')
          : '';

    const inputGuard: InputGuardResult = scanInput(lastUserMessage);
    if (!inputGuard.pass) {
      res.status(400).json({
        error: {
          message: `Request blocked by input guard: ${inputGuard.reason}`,
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

    // ── 3. Resolve upstream provider & provider-specific model candidates ──
    const requestedModel = model;
    const provider = resolveUpstreamProvider(requestedModel);
    const apiKey =
      process.env[provider.apiKeyEnvVar] ||
      (provider.apiKeyEnvVar === 'OLLAMA_API_KEY' ? 'ollama-local-key' : '');
    if (!apiKey) {
      res.status(500).json({
        error: {
          message: `No API key configured for ${provider.name} (env: ${provider.apiKeyEnvVar})`,
          type: 'configuration_error',
        },
      });
      return;
    }

    // ── 4. Circuit breaker check ──
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
        return;
      }
      // FAIL_OPEN: serve a safe fallback without touching the failed upstream.
      console.warn('[Gateway] Circuit breaker OPEN — FAIL_OPEN mode, serving safe fallback');
      res.status(200).json(safeFallbackCompletion('Upstream circuit breaker open', []));
      return;
    }

    // A HALF_OPEN breaker grants one bounded probe: requested model, one attempt.
    const isProbe = upstreamBreaker.isProbing();
    const modelsToTry = isProbe ? [requestedModel] : buildModelCandidates(requestedModel);
    const MAX_RETRIES_PER_MODEL = isProbe ? 1 : 3;

    // ── 5. Forward to upstream with provider-scoped model fallback & exponential backoff ──
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
            ...body,
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
          res.status(resp.status).json({
            error: {
              message: `Upstream error: ${errorBody}`,
              type: 'upstream_error',
            },
          });
          return;
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
        return;
      }
      // FAIL_OPEN: return a safe fallback
      res.status(200).json(safeFallbackCompletion('All upstream models unavailable', modelsToTry));
      return;
    }

    // ── 6. Handle streaming vs non-streaming ──
    const sessionId = (req.headers['x-session-id'] as string) || newInteractionId('anon');
    const sessionKey = `${tenant.orgId}:${tenant.workspaceId}:${sessionId}`;
    const turnNumber = parseInt((req.headers['x-turn-number'] as string) || '1', 10) || 1;

    if (isStreaming) {
      // Streaming: the stream interceptor records audit, telemetry and the gateway event
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
        },
      );
      return;
    }

    // ── 7. Non-streaming: full response evaluation ──
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

    const assistantMessage = upstreamData.choices?.[0]?.message?.content || '';

    // Build a SyntheticInteraction object for the evaluator
    const interaction: SyntheticInteraction = {
      id: newInteractionId('gw'),
      use_case: policy.use_case,
      session_id: sessionId,
      turn_number: turnNumber,
      query_type: 'gateway_request',
      prompt: lastUserMessage,
      retrieved_context: null,
      response: assistantMessage,
      token_count: {
        prompt: upstreamData.usage?.prompt_tokens || 0,
        completion: upstreamData.usage?.completion_tokens || 0,
        total: upstreamData.usage?.total_tokens || 0,
      },
      latency_ms: Math.round(performance.now() - startTime),
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

    // Learn only from trusted traffic, and only after scoring
    learnFromTrustedObservation(interaction, evaluation);

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
    });

    // ── 8. Apply verdict ──
    if (evaluation.verdict === 'BLOCK_ESCALATE' && policy.pre_response_blocking) {
      res.status(200).json({
        ...upstreamData,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content:
                "I'm unable to provide this response as it has been flagged by our governance system. A human reviewer has been notified.",
            },
            finish_reason: 'content_filter',
          },
        ],
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

    // Apply PII redaction if needed
    let finalContent =
      evaluation.responsibility.pii_detected.length > 0
        ? evaluation.responsibility.redacted_response
        : assistantMessage;

    // SOFT_CORRECT carries an accuracy disclaimer, and so does a BLOCK_ESCALATE that a
    // non-pre-blocking policy still delivers when the answer itself is ungrounded
    const deliveredButUngrounded =
      evaluation.verdict === 'BLOCK_ESCALATE' &&
      (evaluation.performance.is_confidently_wrong ||
        evaluation.overlapping_lanes.some((l) => l.startsWith('Performance')));
    if (evaluation.verdict === 'SOFT_CORRECT' || deliveredButUngrounded) {
      finalContent +=
        '\n\n---\n⚠️ *This response has been flagged for potential accuracy concerns. Please verify the information independently before acting on it.*';
    }

    res.json({
      ...upstreamData,
      choices: [
        {
          ...upstreamData.choices?.[0],
          message: {
            role: 'assistant',
            content: finalContent,
          },
        },
      ],
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
