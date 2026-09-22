/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stream Interceptor — Real-time Sliding-Window SSE Interceptor
 *
 * Intercepts Server-Sent Events (SSE) streaming from upstream LLM:
 * 1. Low-latency sliding buffer (zero noticeable TTFT impact, <5ms check)
 * 2. Deterministic Tier 1 checks:
 *    - PII leakage (SSN, credit card with Luhn verification)
 *    - High-risk injection / leaked secrets patterns
 * 3. Fast stream cut: If hard violation detected, terminates stream immediately with
 *    finish_reason: "content_filter"
 * 4. Full response accumulation for background Tier 2/3 governance evaluation
 */

import type { Response } from 'express';
import { validateCreditCard } from '../lib/utils/luhn.js';
import { evaluateInteraction } from '../lib/decisionEngine.js';
import type { PolicyProfile, SessionState, SyntheticInteraction } from '../types.js';

// Fast deterministic regexes for sliding window
const SSN_FAST_REGEX = /\b(?!000|666|9\d{2})\d{3}[- ]\d{2}[- ]\d{4}\b/;
const CARD_FAST_CANDIDATE = /\b(?:\d[ -]*?){13,19}\b/;
const AWS_SECRET_REGEX =
  /(?:AKIA[0-9A-Z]{16}|aws_secret_access_key\s*=\s*['"][a-zA-Z0-9/+=]{40}['"])/;
const GENERIC_API_KEY_REGEX =
  /(?:bearer\s+[a-zA-Z0-9_\-\.]{24,}|api[_-]?key\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}['"])/i;

export interface StreamAuditLog {
  fullText: string;
  tokenCountEstimate: number;
  hardViolationDetected: boolean;
  violationReason?: string;
  ttftMs: number;
  totalDurationMs: number;
}

/**
 * Scans a sliding window chunk of text for hard deterministic breaches.
 */
function scanSlidingWindow(windowText: string): {
  violated: boolean;
  reason?: string;
} {
  // Check AWS / API secrets
  if (AWS_SECRET_REGEX.test(windowText)) {
    return {
      violated: true,
      reason: 'Detected active AWS API credential in streaming output',
    };
  }
  if (GENERIC_API_KEY_REGEX.test(windowText)) {
    return {
      violated: true,
      reason: 'Detected exposed API key token in streaming output',
    };
  }

  // Check SSN
  if (SSN_FAST_REGEX.test(windowText)) {
    return {
      violated: true,
      reason: 'Detected Social Security Number (SSN) in streaming output',
    };
  }

  // Check Credit Card with Luhn validation
  const cardMatch = windowText.match(CARD_FAST_CANDIDATE);
  if (cardMatch) {
    const raw = cardMatch[0].replace(/[\s-]/g, '');
    if (raw.length >= 13 && raw.length <= 19 && /^\d+$/.test(raw)) {
      if (validateCreditCard(raw).isValid) {
        return {
          violated: true,
          reason: 'Detected valid Luhn-verified credit card number in streaming output',
        };
      }
    }
  }

  return { violated: false };
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
): Promise<StreamAuditLog> {
  const streamStart = performance.now();
  let firstTokenTime: number | null = null;
  let accumulatedText = '';
  let slidingBuffer = '';
  const WINDOW_CHAR_SIZE = 120; // ~30 tokens sliding lookback
  let hardViolation = false;
  let violationReason: string | undefined;

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
      ttftMs: 0,
      totalDurationMs: performance.now() - streamStart,
    };
  }

  const decoder = new TextDecoder('utf-8');
  let sseBuffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunkStr = decoder.decode(value, { stream: true });
      sseBuffer += chunkStr;

      // Process complete SSE lines
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() || ''; // Keep trailing incomplete line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) {
          // Comment / keepalive
          clientRes.write(`${line}\n`);
          continue;
        }

        if (trimmed === 'data: [DONE]') {
          clientRes.write('data: [DONE]\n\n');
          continue;
        }

        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          try {
            const parsed = JSON.parse(jsonStr);
            const deltaContent = parsed.choices?.[0]?.delta?.content || '';

            if (deltaContent) {
              if (firstTokenTime === null) {
                firstTokenTime = performance.now() - streamStart;
              }

              accumulatedText += deltaContent;
              slidingBuffer += deltaContent;

              // Maintain sliding window buffer size
              if (slidingBuffer.length > WINDOW_CHAR_SIZE * 2) {
                slidingBuffer = slidingBuffer.slice(-WINDOW_CHAR_SIZE);
              }

              // Run fast deterministic check on current window
              const check = scanSlidingWindow(slidingBuffer);
              if (check.violated && policy.pre_response_blocking) {
                hardViolation = true;
                violationReason = check.reason;
                console.warn(`[StreamInterceptor] Hard violation cut stream: ${check.reason}`);

                // Cancel upstream stream
                await reader.cancel();

                // Emit content_filter termination chunk
                const cutChunk = {
                  id: parsed.id || `cp-cut-${Date.now()}`,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: parsed.model,
                  choices: [
                    {
                      index: 0,
                      delta: {
                        content:
                          '\n\n[STREAM INTERCEPTED BY CONTROLPLANE: Content filter policy triggered]',
                      },
                      finish_reason: 'content_filter',
                    },
                  ],
                  governance_breach: {
                    reason: check.reason,
                    policy_action: 'STREAM_TERMINATED',
                  },
                };

                clientRes.write(`data: ${JSON.stringify(cutChunk)}\n\n`);
                clientRes.write('data: [DONE]\n\n');
                clientRes.end();
                break;
              }
            }

            // Clean chunk: emit immediately to client
            clientRes.write(`${line}\n`);
          } catch {
            // Not valid JSON in data field, pass through raw
            clientRes.write(`${line}\n`);
          }
        } else {
          clientRes.write(`${line}\n`);
        }
      }

      if (hardViolation) {
        break;
      }
    }

    if (!hardViolation) {
      if (sseBuffer.trim()) {
        clientRes.write(`${sseBuffer}\n`);
      }
      clientRes.end();
    }
  } catch (err) {
    console.error('[StreamInterceptor] Error while piping stream:', err);
    if (!clientRes.writableEnded) {
      clientRes.write(`data: ${JSON.stringify({ error: 'Stream interrupted' })}\n\n`);
      clientRes.end();
    }
  }

  const totalDuration = performance.now() - streamStart;
  const tokenEstimate = Math.ceil(accumulatedText.length / 4);

  // Background governance evaluation & session tracking (Tier 2/3)
  try {
    const postInteraction: SyntheticInteraction = {
      id: `stream-${Date.now()}`,
      use_case: policy.use_case,
      session_id: `stream-session-${Date.now()}`,
      turn_number: turnNumber,
      query_type: 'streaming_completion',
      prompt: userPrompt,
      retrieved_context: null,
      response: accumulatedText,
      token_count: {
        prompt: Math.ceil(userPrompt.length / 4),
        completion: tokenEstimate,
        total: Math.ceil(userPrompt.length / 4) + tokenEstimate,
      },
      latency_ms: Math.round(totalDuration),
      ground_truth_labels: hardViolation ? ['pii_leaking'] : ['clean'],
      metadata: {
        created_at: new Date().toISOString(),
        model_name: 'streaming-model',
      },
    };

    const postEval = evaluateInteraction(postInteraction, policy, sessionState);
    sessionState.events.push({
      risk: postEval.composite_risk_score,
      turnNumber,
      timestamp: Date.now(),
    });
    sessionState.currentRisk = postEval.composite_risk_score;
  } catch (evalErr) {
    console.warn('[StreamInterceptor] Post-stream eval failed:', evalErr);
  }

  return {
    fullText: accumulatedText,
    tokenCountEstimate: tokenEstimate,
    hardViolationDetected: hardViolation,
    violationReason,
    ttftMs: firstTokenTime ?? totalDuration,
    totalDurationMs: totalDuration,
  };
}
