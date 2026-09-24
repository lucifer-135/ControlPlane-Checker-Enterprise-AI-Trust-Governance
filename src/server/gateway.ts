/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Gateway — OpenAI-compatible Reverse Proxy Handler
 *
 * Implements POST /v1/chat/completions as a drop-in proxy that:
 * 1. Authenticates the API key
 * 2. Resolves the policy profile from headers
 * 3. Runs pre-flight input guards (prompt injection, rate limiting)
 * 4. Forwards to upstream LLM provider
 * 5. Intercepts the response (streaming or non-streaming)
 * 6. Runs all 3 governance lanes inline
 * 7. Returns augmented response with governance metadata headers
 */

import type { Request, Response } from 'express';
import { evaluateInteraction } from '../lib/decisionEngine.js';
import type { PolicyProfile, SyntheticInteraction, SessionState } from '../types.js';
import { scanInput, type InputGuardResult } from './inputGuard.js';
import { interceptStream } from './streamInterceptor.js';
import { CircuitBreaker } from './circuitBreaker.js';
import { calculateBackoffWithJitter, sleep } from './judge.js';
import { globalBaselineTracker } from './rollingBaseline.js';

// ──────────────────────────────────────────────────────────────────────
// Upstream Provider Configuration
// ──────────────────────────────────────────────────────────────────────

interface UpstreamProvider {
  name: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  transformRequest?: (body: any) => any;
}

const UPSTREAM_PROVIDERS: Record<string, UpstreamProvider> = {
  gemini: {
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnvVar: 'GEMINI_API_KEY',
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnvVar: 'OPENAI_API_KEY',
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
  },
  ollama: {
    name: 'Local Ollama (Qwen)',
    baseUrl: `${(process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '')}/v1`,
    apiKeyEnvVar: 'OLLAMA_API_KEY',
  },
};

/**
 * Resolves which upstream provider to use based on the model string.
 */
function resolveUpstreamProvider(model: string): UpstreamProvider {
  const modelLower = model.toLowerCase();
  if (modelLower.includes('qwen') || modelLower.includes('ollama')) {
    return UPSTREAM_PROVIDERS['ollama'];
  }
  if (modelLower.includes('gemini') || modelLower.includes('models/')) {
    return UPSTREAM_PROVIDERS['gemini'];
  }
  if (modelLower.includes('claude') || modelLower.includes('anthropic')) {
    return UPSTREAM_PROVIDERS['anthropic'];
  }
  // Default to OpenAI for gpt-* models or unknown
  return UPSTREAM_PROVIDERS['openai'];
}

// ──────────────────────────────────────────────────────────────────────
// Session State Management
// ──────────────────────────────────────────────────────────────────────

const gatewaySessions: Record<string, SessionState> = {};
const MAX_SESSIONS = 5000;

function getSessionState(sessionId: string): SessionState {
  if (!gatewaySessions[sessionId]) {
    const keys = Object.keys(gatewaySessions);
    if (keys.length >= MAX_SESSIONS) {
      delete gatewaySessions[keys[0]];
    }
    gatewaySessions[sessionId] = { events: [], currentRisk: 0 };
  }
  return gatewaySessions[sessionId];
}

function updateSessionState(sessionId: string, risk: number, turnNumber: number): void {
  const session = getSessionState(sessionId);
  session.events.push({
    risk,
    turnNumber,
    timestamp: Date.now(),
  });
  session.currentRisk = risk;
}

// ──────────────────────────────────────────────────────────────────────
// Circuit Breaker Instance
// ──────────────────────────────────────────────────────────────────────

const upstreamBreaker = new CircuitBreaker({
  failureThreshold: 5,
  recoveryTimeoutMs: 30000,
  halfOpenMaxAttempts: 2,
});

// ──────────────────────────────────────────────────────────────────────
// Main Gateway Handler
// ──────────────────────────────────────────────────────────────────────

export async function handleChatCompletions(
  req: Request,
  res: Response,
  policyProfiles: Record<string, PolicyProfile>,
): Promise<void> {
  const startTime = performance.now();

  try {
    const body = req.body;
    const model = body.model || 'gemini-3.6-flash';
    const isStreaming = body.stream === true;
    const messages = body.messages || [];

    // ── 1. Resolve policy profile ──
    const policyKey = (req.headers['x-policy-profile'] as string) || 'support_bot';
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
    const rawUserContent = messages.filter((m: any) => m.role === 'user').pop()?.content || '';
    const lastUserMessage =
      typeof rawUserContent === 'string'
        ? rawUserContent
        : Array.isArray(rawUserContent)
          ? rawUserContent.map((p: any) => (typeof p === 'string' ? p : p?.text || '')).join(' ')
          : '';

    const inputGuard: InputGuardResult = scanInput(lastUserMessage, policyKey);
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

    // ── 3. Circuit breaker check ──
    const failMode = (policy as any).failMode || 'FAIL_OPEN';
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
      // FAIL_OPEN: log and bypass governance
      console.warn('[Gateway] Circuit breaker OPEN — FAIL_OPEN mode, bypassing governance');
    }

    // ── 4. Resolve upstream provider & model fallback list ──
    // Uses standard production models and avoids preview/lite variants.
    const GEMINI_FALLBACK_MODELS = Array.from(
      new Set(
        [
          process.env.GEMINI_MODEL,
          'gemini-3.6-flash',
          'gemini-flash-latest',
          'gemini-3.5-flash',
          'gemini-3.7-flash',
        ].filter(Boolean) as string[],
      ),
    );

    // Build ordered model list: requested model first, then fallbacks
    const requestedModel = model;
    const modelsToTry = [
      requestedModel,
      ...GEMINI_FALLBACK_MODELS.filter((m) => m !== requestedModel),
    ];

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

    // ── 5. Forward to upstream with automatic model fallback & exponential backoff ──
    const upstreamUrl = `${provider.baseUrl}/chat/completions`;
    const upstreamHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };

    let upstreamResponse: globalThis.Response | null = null;
    let usedModel = requestedModel;
    let lastError = '';
    const MAX_RETRIES_PER_MODEL = 3;

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

          // Retryable status codes: 503 (overloaded), 429 (rate limited / quota)
          if ([503, 429].includes(resp.status)) {
            const errText = await resp.text();
            lastError = errText;
            if (attempt < MAX_RETRIES_PER_MODEL - 1) {
              const delayMs = calculateBackoffWithJitter(attempt, 2000, 16000, 500);
              console.warn(
                `[Gateway] Model ${candidateModel} returned ${resp.status} (${resp.status === 429 ? 'quota/rate limited' : 'high demand'}). Backing off for ${delayMs}ms with jitter (attempt ${attempt + 1}/${MAX_RETRIES_PER_MODEL})...`,
              );
              await sleep(delayMs);
              continue;
            } else {
              console.warn(
                `[Gateway] Model ${candidateModel} retries exhausted (${resp.status}), advancing to next model tier...`,
              );
              await sleep(1000);
              break;
            }
          }

          // 404 (model not found / deprecated) - skip candidate immediately without redundant retries
          if (resp.status === 404) {
            const errText = await resp.text();
            lastError = errText;
            console.warn(
              `[Gateway] Model ${candidateModel} returned 404 (not found / deprecated), skipping to next tier...`,
            );
            break;
          }

          // Non-retryable error — return immediately
          const errorBody = await resp.text();
          upstreamBreaker.recordFailure();
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
            await sleep(1000);
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
      res.status(200).json({
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
          reason: 'All upstream models unavailable',
          models_attempted: modelsToTry,
        },
      });
      return;
    }

    // ── 6. Handle streaming vs non-streaming ──
    const sessionId = (req.headers['x-session-id'] as string) || `anon-${Date.now()}`;
    const turnNumber = parseInt((req.headers['x-turn-number'] as string) || '1', 10);

    if (isStreaming) {
      // Streaming: use the stream interceptor
      const sessionState = getSessionState(sessionId);
      await interceptStream(
        upstreamResponse,
        res,
        policy,
        lastUserMessage,
        sessionState,
        turnNumber,
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
      id: `gw-${Date.now()}`,
      use_case: policyKey as any,
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

    const sessionState = getSessionState(sessionId);
    const evaluation = evaluateInteraction(interaction, policy, sessionState, (u, q) =>
      globalBaselineTracker.getBaseline(u, q),
    );

    // Feed clean observations back into the rolling baseline tracker
    if (evaluation.verdict !== 'BLOCK_ESCALATE' && interaction.token_count.total > 0) {
      globalBaselineTracker.recordObservation(
        interaction.use_case,
        interaction.query_type,
        interaction.token_count.total,
        interaction.latency_ms,
      );
    }

    // Update session state
    updateSessionState(sessionId, evaluation.composite_risk_score, turnNumber);

    // Set governance headers on all evaluated responses
    res.set({
      'X-ControlPlane-Verdict': evaluation.verdict,
      'X-ControlPlane-Risk-Score': evaluation.composite_risk_score.toString(),
      'X-ControlPlane-Session-Risk': evaluation.session_accumulated_risk.toString(),
      'X-ControlPlane-Policy-Version': policy.version,
      'X-ControlPlane-Latency-Ms': Math.round(performance.now() - startTime).toString(),
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
          triggering_spans: [
            ...evaluation.performance.triggering_spans,
            ...evaluation.responsibility.triggering_spans,
          ],
          policy_violations: evaluation.responsibility.policy_violations,
          added_latency_ms: Math.round(performance.now() - startTime),
        },
      });
      return;
    }

    // For SOFT_CORRECT, inject a disclaimer into the response
    let finalContent = assistantMessage;
    if (evaluation.verdict === 'SOFT_CORRECT') {
      finalContent +=
        '\n\n---\n⚠️ *This response has been flagged for potential accuracy concerns. Please verify the information independently before acting on it.*';
    }

    // Apply PII redaction if needed
    if (evaluation.responsibility.pii_detected.length > 0) {
      finalContent = evaluation.responsibility.redacted_response;
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
