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
};

/**
 * Resolves which upstream provider to use based on the model string.
 */
function resolveUpstreamProvider(model: string): UpstreamProvider {
  const modelLower = model.toLowerCase();
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

function getSessionState(sessionId: string): SessionState {
  if (!gatewaySessions[sessionId]) {
    gatewaySessions[sessionId] = { events: [], currentRisk: 0 };
  }
  return gatewaySessions[sessionId];
}

function updateSessionState(sessionId: string, risk: number, turnNumber: number): void {
  if (!gatewaySessions[sessionId]) {
    gatewaySessions[sessionId] = { events: [], currentRisk: 0 };
  }
  gatewaySessions[sessionId].events.push({
    risk,
    turnNumber,
    timestamp: Date.now(),
  });
  gatewaySessions[sessionId].currentRisk = risk;
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
    const model = body.model || 'gemini-2.0-flash';
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

    // ── 2. Pre-flight input guard ──
    const lastUserMessage = messages.filter((m: any) => m.role === 'user').pop()?.content || '';

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

    // ── 4. Resolve upstream provider ──
    const provider = resolveUpstreamProvider(model);
    const apiKey = process.env[provider.apiKeyEnvVar];
    if (!apiKey) {
      res.status(500).json({
        error: {
          message: `No API key configured for ${provider.name} (env: ${provider.apiKeyEnvVar})`,
          type: 'configuration_error',
        },
      });
      return;
    }

    // ── 5. Forward to upstream ──
    const upstreamUrl = `${provider.baseUrl}/chat/completions`;
    const upstreamHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };

    const upstreamBody = {
      ...body,
      // Ensure stream is passed through
      stream: isStreaming,
    };

    let upstreamResponse: globalThis.Response;
    try {
      upstreamResponse = await fetch(upstreamUrl, {
        method: 'POST',
        headers: upstreamHeaders,
        body: JSON.stringify(upstreamBody),
      });
      upstreamBreaker.recordSuccess();
    } catch (err: any) {
      upstreamBreaker.recordFailure();
      if (failMode === 'FAIL_CLOSED') {
        res.status(502).json({
          error: {
            message: `Upstream provider error: ${err.message}`,
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
          reason: 'Upstream provider unavailable',
        },
      });
      return;
    }

    if (!upstreamResponse.ok) {
      const errorBody = await upstreamResponse.text();
      upstreamBreaker.recordFailure();
      res.status(upstreamResponse.status).json({
        error: {
          message: `Upstream error: ${errorBody}`,
          type: 'upstream_error',
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
    const upstreamData = (await upstreamResponse.json()) as any;
    const assistantMessage = upstreamData.choices?.[0]?.message?.content || '';

    // Build a SyntheticInteraction-like object for the evaluator
    const interaction: SyntheticInteraction = {
      id: `gw-${Date.now()}`,
      use_case: policyKey as any,
      session_id: sessionId,
      turn_number: turnNumber,
      query_type: 'gateway_request',
      prompt: lastUserMessage,
      retrieved_context: null, // Could be extracted from system message or RAG context
      response: assistantMessage,
      token_count: {
        prompt: upstreamData.usage?.prompt_tokens || 0,
        completion: upstreamData.usage?.completion_tokens || 0,
        total: upstreamData.usage?.total_tokens || 0,
      },
      latency_ms: Math.round(performance.now() - startTime),
      ground_truth_labels: ['clean'], // Unknown at gateway time
      metadata: {
        created_at: new Date().toISOString(),
        model_name: model,
      },
    };

    const sessionState = getSessionState(sessionId);
    const evaluation = evaluateInteraction(interaction, policy, sessionState);

    // Update session state
    updateSessionState(sessionId, evaluation.composite_risk_score, turnNumber);

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

    // For BADGE/SOFT_CORRECT/ALLOW, return the response with governance headers
    res.set({
      'X-ControlPlane-Verdict': evaluation.verdict,
      'X-ControlPlane-Risk-Score': evaluation.composite_risk_score.toString(),
      'X-ControlPlane-Session-Risk': evaluation.session_accumulated_risk.toString(),
      'X-ControlPlane-Policy-Version': policy.version,
      'X-ControlPlane-Latency-Ms': Math.round(performance.now() - startTime).toString(),
    });

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
