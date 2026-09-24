import express from 'express';
import http from 'http';
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
  deleteReviewDecision,
  clearReviewDecisions,
  createNewApiKey,
} from './src/server/db/database.js';
import { verifyAuditChain } from './src/server/db/auditChain.js';
import { recordEvaluationTelemetry, getPrometheusMetricsText } from './src/server/telemetry.js';
import {
  evaluateJudgeRequest,
  checkOllamaHealth,
  type JudgeProvider,
  type JudgeRequestOptions,
} from './src/server/judge.js';
import {
  scanInput,
  getRateLimitStatus,
  recordSimulatedRequest,
  resetRateLimits,
} from './src/lib/inputGuard.js';

dotenv.config();

// Initialize SQLite database
initDatabase();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json({ limit: '2mb' }));
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof SyntaxError && 'status' in err && (err as any).status === 400) {
    return res.status(400).json({
      error: {
        message: 'Malformed JSON payload in request body',
        type: 'invalid_request_error',
      },
    });
  }
  next(err);
});

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

// Health check endpoint (checks Gemini API Key and Local Ollama status)
app.get('/api/health', async (_req, res) => {
  const localLLM = await checkOllamaHealth();
  res.json({
    status: 'ok',
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    localLLM: {
      available: localLLM.available,
      installed: localLLM.installed,
      endpoint: localLLM.endpoint,
      model: process.env.LOCAL_JUDGE_MODEL || 'qwen2.5:7b',
      models: localLLM.models,
    },
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

// POST /api/input-guard - Live pre-flight input guard analysis
app.post('/api/input-guard', (req, res) => {
  try {
    const input = req.body.input || req.body.prompt || '';
    const apiKey = req.body.apiKey || 'cp_live_default_admin_key_2026';
    const result = scanInput(input, apiKey);
    const rateLimit = getRateLimitStatus(apiKey);
    res.json({
      ...result,
      rateLimit,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Input guard evaluation failed' });
  }
});

// POST /api/rate-limit/simulate - Simulate request bursts or reset rate limits
app.post('/api/rate-limit/simulate', (req, res) => {
  try {
    const apiKey = req.body.apiKey || 'cp_live_default_admin_key_2026';
    const count = parseInt(req.body.count, 10) || 10;
    recordSimulatedRequest(apiKey, count);
    res.json({
      status: 'simulated',
      added: count,
      rateLimit: getRateLimitStatus(apiKey),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rate-limit/reset', (req, res) => {
  try {
    resetRateLimits();
    const apiKey = req.body.apiKey || 'cp_live_default_admin_key_2026';
    res.json({
      status: 'reset',
      rateLimit: getRateLimitStatus(apiKey),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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

app.post('/api/baselines/reset', (_req, res) => {
  globalBaselineTracker.reset(true);
  res.json({
    status: 'reset',
    message: 'Rolling baseline tracker reset to seeded default metrics',
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

    if (
      req.body.recordObservation === true &&
      interaction.token_count?.total &&
      interaction.latency_ms
    ) {
      globalBaselineTracker.recordObservation(
        interaction.use_case,
        interaction.query_type,
        interaction.token_count.total,
        interaction.latency_ms,
      );
    }

    const result = evaluateInteraction(interaction, policy, sessionState, (u, q) =>
      globalBaselineTracker.getBaseline(u, q),
    );

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
    const result = evaluateDataset(interactions, profiles, (u, q) =>
      globalBaselineTracker.getBaseline(u, q),
    );
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
// Human-In-The-Lead (HITL) Review Decision Endpoints
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

// DELETE /api/review-decisions/:id - Delete a specific review decision and restore item to queue
app.delete('/api/review-decisions/:id', (req, res) => {
  try {
    const { id } = req.params;
    const deleted = deleteReviewDecision(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Review decision not found' });
    }
    res.json({ status: 'deleted', id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/review-decisions - Reset / clear all recorded review decisions
app.delete('/api/review-decisions', (_req, res) => {
  try {
    const count = clearReviewDecisions();
    res.json({ status: 'cleared', count });
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

// LLM Judge endpoint supporting Google Gemini, Local Qwen 2.5: 7B (Ollama), and Dual Consensus
app.post('/api/judge', async (req, res) => {
  try {
    const prompt = req.body.prompt || '';
    const retrievedContext = req.body.retrievedContext || req.body.context || '';
    const responseText = req.body.responseText || req.body.response || '';
    const useCase = (req.body.useCase as UseCaseId) || 'support_bot';
    const claim = req.body.claim || '';
    const provider = (req.body.provider || req.query.provider || 'gemini') as JudgeProvider;
    const model = req.body.model;

    const judgeOptions: JudgeRequestOptions = {
      prompt,
      retrievedContext,
      responseText,
      useCase,
      claim,
      provider,
      model,
    };

    const ai = getGeminiClient();
    const result = await evaluateJudgeRequest(judgeOptions, ai);

    return res.json(result);
  } catch (error: any) {
    console.error('Judge endpoint error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to execute judge evaluation',
    });
  }
});

async function startServer() {
  const httpServer = http.createServer(app);

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: {
          server: httpServer,
        },
      },
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

  const server = httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`ControlPlane Checker Server running on http://localhost:${PORT}`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[Server Error] Port ${PORT} is already in use by another process.`);
      console.error(
        `To release port ${PORT} on Windows, run:\n  Get-Process -Id (Get-NetTCPConnection -LocalPort ${PORT}).OwningProcess | Stop-Process -Force\n`,
      );
      process.exit(1);
    } else {
      console.error('[Server Error] Fatal error:', err);
      process.exit(1);
    }
  });

  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer();
