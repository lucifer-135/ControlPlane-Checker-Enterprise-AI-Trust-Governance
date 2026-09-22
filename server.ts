import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import {
  evaluateInteraction,
  evaluateDataset,
  SessionAccumulatorMap,
} from './src/lib/decisionEngine.js';
import { evaluatePerformanceLane } from './src/lib/lanes/performanceLane.js';
import { DEFAULT_POLICY_PROFILES } from './src/lib/policyProfiles.js';
import { SYNTHETIC_INTERACTIONS } from './src/data/interactions.js';
import type { PolicyProfile, UseCaseId, SyntheticInteraction, SessionState } from './src/types.js';
import { loadPoliciesFromDir, watchPoliciesDir } from './src/server/policyLoader.js';
import { handleChatCompletions } from './src/server/gateway.js';
import { globalBaselineTracker } from './src/server/rollingBaseline.js';
import {
  initDatabase,
  insertAuditLog,
  getAuditLogs,
  getAllAuditLogsForVerification,
  insertReviewDecision,
  getReviewDecisions,
  createNewApiKey,
} from './src/server/db/database.js';
import { verifyAuditChain } from './src/server/db/auditChain.js';
import { recordEvaluationTelemetry, getPrometheusMetricsText } from './src/server/telemetry.js';

dotenv.config();

// Initialize SQLite database
initDatabase();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json({ limit: '2mb' }));

// Lazy-initialized Gemini client
let genAIClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!genAIClient && process.env.GEMINI_API_KEY) {
    genAIClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return genAIClient;
}

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    timestamp: new Date().toISOString(),
  });
});

// ──────────────────────────────────────────────────────────────────────
// Server-side Policy Profiles (Loaded from YAML, GitOps enabled)
// ──────────────────────────────────────────────────────────────────────
let serverPolicyProfiles: Record<string, PolicyProfile> = loadPoliciesFromDir();

// Watch ./policies directory for live hot-reload without restart
watchPoliciesDir(undefined, (updatedProfiles) => {
  serverPolicyProfiles = updatedProfiles;
  console.log('[Server] Hot-reloaded policy profiles from YAML files');
});

// GET /api/policies - Retrieve all active policy profiles
app.get('/api/policies', (_req, res) => {
  res.json(serverPolicyProfiles);
});

// PUT /api/policies/:useCase - Update a single policy profile
app.put('/api/policies/:useCase', (req, res) => {
  const useCase = req.params.useCase as UseCaseId;
  if (!serverPolicyProfiles[useCase]) {
    return res.status(404).json({ error: `Unknown use case: ${useCase}` });
  }
  serverPolicyProfiles[useCase] = req.body;
  res.json({
    status: 'updated',
    useCase,
    profile: serverPolicyProfiles[useCase],
  });
});

// POST /api/policies/reset - Reset all profiles to defaults
app.post('/api/policies/reset', (_req, res) => {
  serverPolicyProfiles = loadPoliciesFromDir();
  res.json({ status: 'reset', profiles: serverPolicyProfiles });
});

// ──────────────────────────────────────────────────────────────────────
// Live AI Governance Gateway (OpenAI-compatible drop-in reverse proxy)
// ──────────────────────────────────────────────────────────────────────

// POST /v1/chat/completions - Drop-in proxy intercepting streaming & non-streaming completions
app.post('/v1/chat/completions', (req, res) => {
  handleChatCompletions(req, res, serverPolicyProfiles);
});

// Alias without /v1 prefix
app.post('/chat/completions', (req, res) => {
  handleChatCompletions(req, res, serverPolicyProfiles);
});

// ──────────────────────────────────────────────────────────────────────
// Dynamic Rolling Baselines (Streaming Welford algorithm)
// ──────────────────────────────────────────────────────────────────────

app.get('/api/baselines', (req, res) => {
  const useCase = (req.query.useCase as UseCaseId) || 'support_bot';
  const queryType = (req.query.queryType as string) || 'general';
  res.json(globalBaselineTracker.getBaseline(useCase, queryType));
});

app.post('/api/baselines/observe', (req, res) => {
  const { useCase, queryType, totalTokens, latencyMs } = req.body;
  if (!useCase || !queryType || totalTokens === undefined || latencyMs === undefined) {
    return res.status(400).json({
      error: 'Missing required fields: useCase, queryType, totalTokens, latencyMs',
    });
  }
  globalBaselineTracker.recordObservation(useCase, queryType, totalTokens, latencyMs);
  res.json({
    status: 'recorded',
    baseline: globalBaselineTracker.getBaseline(useCase, queryType),
  });
});

// ──────────────────────────────────────────────────────────────────────
// Server-side Evaluation Endpoints
// ──────────────────────────────────────────────────────────────────────

// In-memory session accumulators for server-side evaluation
let sessionAccumulators: SessionAccumulatorMap = {};

// POST /api/evaluate - Evaluate a single interaction
app.post('/api/evaluate', (req, res) => {
  try {
    const interaction: SyntheticInteraction = req.body.interaction;
    const policy: PolicyProfile = req.body.policy || serverPolicyProfiles[interaction.use_case];
    const sessionState: SessionState = req.body.sessionState ||
      sessionAccumulators[interaction.session_id] || {
        events: [],
        currentRisk: 0,
      };

    const result = evaluateInteraction(interaction, policy, sessionState);

    // Update session state
    if (!sessionAccumulators[interaction.session_id]) {
      sessionAccumulators[interaction.session_id] = {
        events: [],
        currentRisk: 0,
      };
    }
    sessionAccumulators[interaction.session_id].events.push({
      risk: result.composite_risk_score,
      turnNumber: interaction.turn_number,
      timestamp: Date.now(),
    });
    sessionAccumulators[interaction.session_id].currentRisk = result.session_accumulated_risk;

    // Persist to immutable audit log with cryptographic HMAC chain
    try {
      insertAuditLog(interaction, result);
      recordEvaluationTelemetry(
        result.verdict,
        result.use_case,
        result.responsibility.pii_detected.map((p) => p.type),
        result.performance.risk_score >= 0.4,
        result.has_multi_lane_overlap,
        result.added_overhead_latency_ms,
      );
    } catch (dbErr) {
      console.warn('[Server] Failed to persist audit record:', dbErr);
    }

    res.json(result);
  } catch (error: any) {
    console.error('Evaluate error:', error);
    res.status(500).json({ error: error.message || 'Evaluation failed' });
  }
});

// POST /api/evaluate/batch - Evaluate all synthetic interactions
app.post('/api/evaluate/batch', (req, res) => {
  try {
    const profiles: Record<UseCaseId, PolicyProfile> =
      req.body.profiles || (serverPolicyProfiles as Record<UseCaseId, PolicyProfile>);
    const interactions: SyntheticInteraction[] = req.body.interactions || SYNTHETIC_INTERACTIONS;

    // Reset session accumulators for batch re-evaluation
    sessionAccumulators = {};
    const result = evaluateDataset(interactions, profiles);
    sessionAccumulators = result.sessionAccumulators;

    // Persist batch evaluations to audit log & telemetry
    try {
      for (const inter of interactions) {
        const evalRes = result.evaluations[inter.id];
        if (evalRes) {
          insertAuditLog(inter, evalRes);
          recordEvaluationTelemetry(
            evalRes.verdict,
            evalRes.use_case,
            evalRes.responsibility.pii_detected.map((p) => p.type),
            evalRes.performance.risk_score >= 0.4,
            evalRes.has_multi_lane_overlap,
            evalRes.added_overhead_latency_ms,
          );
        }
      }
    } catch (dbErr) {
      console.warn('[Server] Batch audit persistence error:', dbErr);
    }

    res.json(result);
  } catch (error: any) {
    console.error('Batch evaluate error:', error);
    res.status(500).json({ error: error.message || 'Batch evaluation failed' });
  }
});

// ──────────────────────────────────────────────────────────────────────
// Immutable Audit Trail & Cryptographic Verification Endpoints
// ──────────────────────────────────────────────────────────────────────

// GET /api/audit-logs - Paginated audit logs query
app.get('/api/audit-logs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const logs = getAuditLogs(limit, offset);
    res.json({ logs, limit, offset });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/audit-logs/verify - Cryptographic HMAC chain integrity verification
app.get('/api/audit-logs/verify', (_req, res) => {
  try {
    const allLogs = getAllAuditLogsForVerification();
    const verification = verifyAuditChain(allLogs);
    res.json({
      status: verification.valid ? 'INTEGRITY_VERIFIED' : 'TAMPER_DETECTED',
      ...verification,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────
// Human-In-The-Loop (HITL) Review Decision Endpoints
// ──────────────────────────────────────────────────────────────────────

// GET /api/review-decisions - Query persisted review decisions
app.get('/api/review-decisions', (req, res) => {
  try {
    const interactionId = req.query.interactionId as string | undefined;
    const decisions = getReviewDecisions(interactionId);
    res.json(decisions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/review-decisions - Persist an adjudication decision
app.post('/api/review-decisions', (req, res) => {
  try {
    const decision = req.body;
    if (!decision || !decision.id || !decision.interaction_id || !decision.action) {
      return res.status(400).json({ error: 'Missing required decision fields' });
    }
    insertReviewDecision(decision);
    res.json({ status: 'persisted', decision });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────
// Multi-Tenant API Key Management
// ──────────────────────────────────────────────────────────────────────

// POST /api/keys - Create a new API key for a tenant org/workspace
app.post('/api/keys', (req, res) => {
  try {
    const { orgId, workspaceId, description, policyProfile, rateLimitRpm } = req.body;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required' });
    }
    const result = createNewApiKey(
      orgId,
      workspaceId || 'default',
      description || '',
      policyProfile || 'support_bot',
      rateLimitRpm || 100,
    );
    res.json({
      status: 'created',
      apiKey: result.rawKey,
      keyInfo: result.keyInfo,
      warning: 'Store this API key safely; it cannot be retrieved again in plaintext.',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────
// Prometheus Metrics Exporter
// ──────────────────────────────────────────────────────────────────────

app.get('/api/metrics', (_req, res) => {
  res.set('Content-Type', 'text/plain; version=0.0.4');
  res.send(getPrometheusMetricsText());
});

// Helper for dynamic semantic evaluation fallback
function generateDynamicJudgeFallback(
  prompt: string,
  retrievedContext: string,
  responseText: string,
  useCase: UseCaseId,
  claim?: string,
  reasonPrefix: string = 'Autonomous Governance Evaluator',
) {
  const perf = evaluatePerformanceLane(prompt, retrievedContext, responseText, useCase);
  let verdict: 'SUPPORTED' | 'AMBIGUOUS' | 'CONFIDENTLY_WRONG' | 'UNSUPPORTED' = 'SUPPORTED';

  if (perf.is_confidently_wrong) {
    verdict = 'CONFIDENTLY_WRONG';
  } else if (perf.groundedness_score < 0.4) {
    verdict = 'UNSUPPORTED';
  } else if (perf.is_ambiguous) {
    verdict = 'AMBIGUOUS';
  }

  let reasoning = `${reasonPrefix}: The response is consistent with and supported by the retrieved reference context.`;
  if (verdict === 'CONFIDENTLY_WRONG') {
    reasoning = `${reasonPrefix}: Assertion certainty bounds mismatch. The response makes assertive claims that directly contradict or exceed the provided reference context (${perf.explanation}).`;
  } else if (verdict === 'UNSUPPORTED') {
    reasoning = `${reasonPrefix}: The response contains assertions not substantiated by the provided reference context (${perf.explanation}).`;
  } else if (verdict === 'AMBIGUOUS') {
    reasoning = `${reasonPrefix}: Partial semantic overlap observed with borderline factual support (${perf.explanation}).`;
  }

  const triggeringSpans = perf.triggering_spans.map((s) => s.text);
  if (triggeringSpans.length === 0 && verdict !== 'SUPPORTED') {
    triggeringSpans.push(claim || responseText.slice(0, 80));
  }

  return {
    isLiveLLM: false,
    modelUsed: 'autonomous-evaluator-fallback',
    groundednessScore: Number(perf.groundedness_score.toFixed(2)),
    certaintyScore: Number(perf.certainty_score.toFixed(2)),
    certaintySupportMismatch: Number(perf.certainty_support_mismatch.toFixed(2)),
    verdict,
    reasoning,
    triggeringSpans,
  };
}

// Gemini LLM Judge endpoint for ambiguous groundedness / tie-breaker evaluation
app.post('/api/judge', async (req, res) => {
  try {
    const prompt = req.body.prompt || '';
    const retrievedContext = req.body.retrievedContext || req.body.context || '';
    const responseText = req.body.responseText || req.body.response || '';
    const useCase = (req.body.useCase as UseCaseId) || 'support_bot';
    const claim = req.body.claim || '';

    const ai = getGeminiClient();
    if (!ai) {
      // Dynamic semantic evaluation when no live key is configured
      return res
        .status(200)
        .json(
          generateDynamicJudgeFallback(
            prompt,
            retrievedContext,
            responseText,
            useCase,
            claim,
            'Autonomous Evaluator (Local Engine)',
          ),
        );
    }

    const systemPrompt = `You are an enterprise AI Governance LLM Judge for the ControlPlane Checker system.
Evaluate the given AI Interaction for Groundedness, Hallucination, and Certainty vs. Support Mismatch.
A "confidently wrong" response expresses high linguistic certainty (e.g. "is definitely", "guaranteed", "proven to be") while lacking supporting evidence in the retrieved context.

Return ONLY a JSON object adhering to this schema:
{
  "groundednessScore": number (0.0 to 1.0, where 1.0 is 100% supported by context, 0.0 is pure fabrication),
  "certaintyScore": number (0.0 to 1.0, linguistic confidence/assertiveness of the AI response),
  "certaintySupportMismatch": number (0.0 to 1.0, discrepancy between asserted certainty and evidence support),
  "verdict": "SUPPORTED" | "AMBIGUOUS" | "CONFIDENTLY_WRONG" | "UNSUPPORTED",
  "reasoning": string (concise explanation of findings in 2-3 sentences),
  "triggeringSpans": string[] (exact phrases in response that represent unsupported or exaggerated claims)
}`;

    const userContent = `Use Case: ${useCase || 'general'}
User Prompt: ${prompt}
Retrieved Context: ${retrievedContext || '[No context provided - verify general world knowledge and unverified claim bounds]'}
AI Response: ${responseText}
${claim ? `Specific Claim to Examine: "${claim}"` : ''}`;

    let responseTextRaw = '{}';
    let modelUsed = '';
    const modelsToTry = [
      'gemini-3.1-flash-lite-preview',
      'gemini-3.1-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3-flash-preview',
    ];
    let succeeded = false;

    for (const model of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: userContent,
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: 'application/json',
          },
        });
        if (response.text) {
          responseTextRaw = response.text.trim();
          modelUsed = model;
          succeeded = true;
          break;
        }
      } catch (err: any) {
        console.warn(`Model ${model} failed (${err.message}), trying next fallback...`);
      }
    }

    if (!succeeded) {
      // Dynamic fallback based on actual prompt, context, and response
      return res.json(
        generateDynamicJudgeFallback(
          prompt,
          retrievedContext,
          responseText,
          useCase,
          claim,
          'Autonomous Governance Evaluator (High-demand fallback)',
        ),
      );
    }

    const parsed = JSON.parse(responseTextRaw || '{}');
    return res.json({
      isLiveLLM: true,
      modelUsed,
      ...parsed,
      verdict: (parsed.verdict || 'SUPPORTED').toUpperCase(),
    });
  } catch (error: any) {
    console.error('Gemini Judge error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to execute judge evaluation',
    });
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ControlPlane Checker Server running on http://localhost:${PORT}`);
  });
}

startServer();
