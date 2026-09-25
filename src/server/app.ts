/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Express application factory.
 *
 * All API routes live here so tests can mount the real middleware chain.
 * `server.ts` adds process concerns (database file, Vite/static serving,
 * listening, shutdown).
 *
 * Authorization (roles, lowest to highest: service < viewer < reviewer < admin):
 * - public:   GET /api/health
 * - service:  proxy (/v1/chat/completions), /api/judge, /api/evaluate(/batch)
 * - viewer:   reads (policies, baselines, audit logs, review decisions,
 *             gateway events/escalations, metrics), input guard
 * - reviewer: POST /api/review-decisions
 * - admin:    policy writes/reset, baseline writes, rate-limit tools, key
 *             creation, audit chain verification
 * All reads are scoped to the caller's tenant (see auth.ts).
 */

import express from 'express';
import { GoogleGenAI } from '@google/genai';
import {
  evaluateInteraction,
  evaluateDataset,
  type SessionAccumulatorMap,
} from '../lib/decisionEngine.js';
import { DEFAULT_POLICY_PROFILES } from '../lib/policyProfiles.js';
import { SYNTHETIC_INTERACTIONS } from '../data/interactions.js';
import type {
  PolicyProfile,
  ReviewDecision,
  SessionState,
  SyntheticInteraction,
  UseCaseId,
} from '../types.js';
import { loadPoliciesFromDir, watchPoliciesDir, writePolicyToFile } from './policyLoader.js';
import { handleChatCompletions, learnFromTrustedObservation } from './gateway.js';
import {
  authenticate,
  requireRole,
  tenantFilterFor,
  tenantMatches,
  tenantStampFor,
  type AuthenticatedRequest,
} from './auth.js';
import { getAuthMode, type AuthMode } from './config.js';
import { globalBaselineTracker, validateObservation } from './rollingBaseline.js';
import { flushBaselineState } from './baselinePersistence.js';
import {
  insertAuditLog,
  getAuditLogs,
  getAllAuditLogsForVerification,
  insertReviewDecision,
  getReviewDecisions,
  getGatewayEscalationEvent,
  createNewApiKey,
  DuplicateReviewDecisionError,
  API_KEY_ROLES,
  type ApiKeyRole,
} from './db/database.js';
import { verifyAuditChain } from './db/auditChain.js';
import { recordEvaluationTelemetry, getPrometheusMetricsText } from './telemetry.js';
import {
  evaluateJudgeRequest,
  checkOllamaHealth,
  type JudgeProvider,
  type JudgeRequestOptions,
} from './judge.js';
import {
  scanInput,
  getRateLimitStatus,
  recordSimulatedRequest,
  resetRateLimits,
} from '../lib/inputGuard.js';
import {
  getRecentGatewayEvents,
  getPendingEscalations,
  addSSEClient,
  removeSSEClient,
} from './gatewayEvents.js';

export interface CreateAppOptions {
  /** Directory holding policy YAML files (defaults to ./policies). */
  policiesDir?: string;
  /** Hot-reload policies when files change. */
  watchPolicies?: boolean;
  /** Overrides the configured auth mode (production is always 'required'). */
  authMode?: AuthMode;
}

export interface CreatedApp {
  app: express.Express;
  getPolicies: () => Record<string, PolicyProfile>;
  stop: () => void;
}

const REVIEW_ACTIONS: ReviewDecision['action'][] = [
  'CONFIRM_BLOCK',
  'OVERRIDE_ALLOW',
  'EDIT_ALLOW',
];

/**
 * Accountable identity for review decisions, derived from the authenticated
 * principal: the key's description and role, its tenant, and a short key
 * fingerprint (never the key itself).
 */
function reviewerIdentity(req: AuthenticatedRequest): string {
  const principal = req.principal;
  if (!principal || principal.kind === 'local_dev') return 'Local dev admin (no API key)';
  const label = req.apiKeyInfo?.description?.trim() || `${principal.role} key`;
  const fingerprint = principal.keyHash ? ` · key …${principal.keyHash.slice(-6)}` : '';
  return `${label} (${principal.orgId}/${principal.workspaceId}${fingerprint})`;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Returns an error message if a merged policy profile is not safe to apply. */
function validatePolicyProfile(profile: PolicyProfile): string | null {
  for (const [key, value] of Object.entries(profile.thresholds)) {
    if (!isFiniteNumber(value) || value < 0)
      return `thresholds.${key} must be a non-negative number`;
    if (key !== 'cost_z_score_cutoff' && value > 1) return `thresholds.${key} must be ≤ 1`;
  }
  for (const [key, value] of Object.entries(profile.lane_weights)) {
    if (!isFiniteNumber(value) || value < 0)
      return `lane_weights.${key} must be a non-negative number`;
  }
  if (!isFiniteNumber(profile.latency_budget_ms) || profile.latency_budget_ms <= 0) {
    return 'latency_budget_ms must be a positive number';
  }
  if (profile.failMode && !['FAIL_OPEN', 'FAIL_CLOSED'].includes(profile.failMode)) {
    return 'failMode must be FAIL_OPEN or FAIL_CLOSED';
  }
  return null;
}

/**
 * @throws DuplicatePolicyError if the policies directory defines a use_case twice.
 */
export function createApp(options: CreateAppOptions = {}): CreatedApp {
  const app = express();
  const authMode = options.authMode ?? getAuthMode();
  const auth = authenticate({ mode: authMode });

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

  // Health check endpoint (public; checks Gemini API Key and Local Ollama status)
  app.get('/api/health', async (_req, res) => {
    const localLLM = await checkOllamaHealth();
    res.json({
      status: 'ok',
      authMode,
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

  // Every other /api route requires an authenticated principal
  app.use('/api', auth);

  const viewer = requireRole('viewer');
  const reviewer = requireRole('reviewer');
  const admin = requireRole('admin');

  // ──────────────────────────────────────────────────────────────────────
  // Server-side Policy Profiles (Loaded from YAML, GitOps enabled)
  // ──────────────────────────────────────────────────────────────────────
  const policiesDir = options.policiesDir;
  let serverPolicyProfiles: Record<string, PolicyProfile> = loadPoliciesFromDir(policiesDir);

  const watcher = options.watchPolicies
    ? watchPoliciesDir(policiesDir, (updatedProfiles) => {
        serverPolicyProfiles = updatedProfiles;
        console.log('[Server] Hot-reloaded policy profiles from YAML files');
      })
    : null;

  app.get('/api/policies', viewer, (_req, res) => {
    res.json(serverPolicyProfiles);
  });

  // PUT /api/policies/:useCase - Update a single policy profile and persist to YAML
  app.put('/api/policies/:useCase', admin, (req, res) => {
    const useCase = req.params.useCase as UseCaseId;
    if (!serverPolicyProfiles[useCase]) {
      return res.status(404).json({ error: `Unknown use case: ${useCase}` });
    }
    const current = serverPolicyProfiles[useCase];
    const updatedProfile: PolicyProfile = {
      ...current,
      ...req.body,
      use_case: useCase,
      thresholds: { ...current.thresholds, ...(req.body?.thresholds || {}) },
      lane_weights: { ...current.lane_weights, ...(req.body?.lane_weights || {}) },
      active_lanes: { ...current.active_lanes, ...(req.body?.active_lanes || {}) },
    };
    const invalid = validatePolicyProfile(updatedProfile);
    if (invalid) {
      return res.status(400).json({ error: invalid });
    }

    // Persist first: the in-memory profile only changes if the YAML write succeeds
    try {
      writePolicyToFile(updatedProfile, policiesDir);
    } catch (writeErr: any) {
      console.error('[Server] Failed to persist policy to YAML:', writeErr);
      return res
        .status(500)
        .json({ error: `Failed to persist policy: ${writeErr?.message || writeErr}` });
    }
    serverPolicyProfiles = { ...serverPolicyProfiles, [useCase]: updatedProfile };

    res.json({
      status: 'updated',
      useCase,
      profile: updatedProfile,
    });
  });

  // POST /api/policies/reset - Reset all profiles to default values and restore YAML files
  app.post('/api/policies/reset', admin, (_req, res) => {
    const defaults: Record<string, PolicyProfile> = JSON.parse(
      JSON.stringify(DEFAULT_POLICY_PROFILES),
    );
    try {
      for (const profile of Object.values(defaults)) {
        writePolicyToFile(profile, policiesDir);
      }
      console.log('[Server] Reset policy profiles to defaults and restored YAML files');
    } catch (writeErr: any) {
      console.error('[Server] Failed to write default policies to YAML:', writeErr);
      return res
        .status(500)
        .json({ error: `Failed to persist default policies: ${writeErr?.message || writeErr}` });
    }
    serverPolicyProfiles = defaults;
    res.json({ status: 'reset', profiles: serverPolicyProfiles });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Live AI Governance Gateway (OpenAI-compatible drop-in reverse proxy)
  // ──────────────────────────────────────────────────────────────────────

  // POST /v1/chat/completions - Drop-in proxy intercepting streaming & non-streaming completions.
  // Any active API key may call the proxy; a key's bound policy profile wins over headers.
  app.post('/v1/chat/completions', auth, (req, res) => {
    handleChatCompletions(req as AuthenticatedRequest, res, serverPolicyProfiles);
  });

  // Alias without /v1 prefix
  app.post('/chat/completions', auth, (req, res) => {
    handleChatCompletions(req as AuthenticatedRequest, res, serverPolicyProfiles);
  });

  // Rate-limit bucket for the caller (matches the bucket used by the auth middleware)
  const rateLimitBucket = (req: AuthenticatedRequest) => req.principal?.keyHash || 'local-dev';
  const rateLimitRpm = (req: AuthenticatedRequest) => req.apiKeyInfo?.rate_limit_rpm;

  // POST /api/input-guard - Live pre-flight input guard analysis
  app.post('/api/input-guard', viewer, (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const input = req.body.input || req.body.prompt || '';
      const result = scanInput(input);
      const rateLimit = getRateLimitStatus(rateLimitBucket(authReq), rateLimitRpm(authReq));
      res.json({
        ...result,
        rateLimit,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Input guard evaluation failed' });
    }
  });

  // POST /api/rate-limit/simulate - Simulate request bursts against the caller's own bucket
  app.post('/api/rate-limit/simulate', admin, (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const count = clampInt(req.body.count, 10, 1, 1000);
      recordSimulatedRequest(rateLimitBucket(authReq), count);
      res.json({
        status: 'simulated',
        added: count,
        rateLimit: getRateLimitStatus(rateLimitBucket(authReq), rateLimitRpm(authReq)),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/rate-limit/reset - Resets the caller's bucket (local dev: all buckets)
  app.post('/api/rate-limit/reset', admin, (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      resetRateLimits(
        authReq.principal?.kind === 'local_dev' ? undefined : rateLimitBucket(authReq),
      );
      res.json({
        status: 'reset',
        rateLimit: getRateLimitStatus(rateLimitBucket(authReq), rateLimitRpm(authReq)),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // Dynamic Rolling Baselines (Streaming Welford algorithm)
  // ──────────────────────────────────────────────────────────────────────

  app.get('/api/baselines', viewer, (req, res) => {
    const useCase = (req.query.useCase as UseCaseId) || 'support_bot';
    const queryType = (req.query.queryType as string) || 'general';
    res.json(globalBaselineTracker.getBaseline(useCase, queryType));
  });

  // Manual observations are an administrative override: they bypass the
  // trusted-traffic filter, so they are validated strictly.
  app.post('/api/baselines/observe', admin, (req, res) => {
    const { useCase, queryType, totalTokens, latencyMs } = req.body || {};
    const invalid = validateObservation(useCase, queryType, totalTokens, latencyMs);
    if (invalid) {
      return res.status(400).json({ error: invalid });
    }
    globalBaselineTracker.recordObservation(useCase, queryType, totalTokens, latencyMs);
    flushBaselineState();
    res.json({
      status: 'recorded',
      baseline: globalBaselineTracker.getBaseline(useCase, queryType),
    });
  });

  app.post('/api/baselines/reset', admin, (_req, res) => {
    globalBaselineTracker.reset(true);
    flushBaselineState(true);
    res.json({
      status: 'reset',
      message: 'Rolling baseline tracker reset to seeded default metrics',
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Server-side Evaluation Endpoints
  // ──────────────────────────────────────────────────────────────────────

  // In-memory session accumulators for single-interaction evaluation
  const sessionAccumulators: SessionAccumulatorMap = {};

  // POST /api/evaluate - Evaluate a single interaction.
  // Simulation by default; `persist: true` writes the audit record, telemetry, and
  // (for trusted results) a baseline observation — always after scoring.
  app.post('/api/evaluate', (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const interaction: SyntheticInteraction = req.body.interaction;
      if (!interaction || typeof interaction !== 'object' || !interaction.use_case) {
        return res.status(400).json({ error: 'interaction is required' });
      }
      const persist = req.body.persist === true;
      // Audit records are always scored against the server's policy, never a caller-supplied one
      const policy: PolicyProfile =
        (!persist && req.body.policy) || serverPolicyProfiles[interaction.use_case];
      if (!policy) {
        return res.status(400).json({ error: `Unknown use case: ${interaction.use_case}` });
      }
      const tenant = tenantStampFor(authReq.principal);
      const sessionKey = `${tenant.orgId}:${tenant.workspaceId}:${interaction.session_id}`;
      const sessionState: SessionState = req.body.sessionState ||
        sessionAccumulators[sessionKey] || {
          events: [],
          currentRisk: 0,
        };

      const result = evaluateInteraction(interaction, policy, sessionState, (u, q) =>
        globalBaselineTracker.getBaseline(u, q),
      );

      if (persist) {
        if (!sessionAccumulators[sessionKey]) {
          sessionAccumulators[sessionKey] = { events: [], currentRisk: 0 };
        }
        sessionAccumulators[sessionKey].events.push({
          risk: result.composite_risk_score,
          turnNumber: interaction.turn_number,
          timestamp: Date.now(),
        });
        sessionAccumulators[sessionKey].currentRisk = result.session_accumulated_risk;

        if (
          req.body.recordObservation === true &&
          interaction.token_count &&
          interaction.latency_ms
        ) {
          learnFromTrustedObservation(interaction, result);
        }

        // Persist to immutable audit log with cryptographic HMAC chain
        try {
          insertAuditLog(interaction, result, { tenant });
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
      }

      res.json(result);
    } catch (error: any) {
      console.error('Evaluate error:', error);
      res.status(500).json({ error: error.message || 'Evaluation failed' });
    }
  });

  // POST /api/evaluate/batch - Evaluate a dataset (defaults to the synthetic dataset).
  // Dashboard simulation: no audit/telemetry writes unless `persist: true`.
  app.post('/api/evaluate/batch', (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const persist = req.body.persist === true;
      // Audit records are always scored against the server's policies
      const profiles: Record<UseCaseId, PolicyProfile> =
        (!persist && req.body.profiles) ||
        (serverPolicyProfiles as Record<UseCaseId, PolicyProfile>);
      const interactions: SyntheticInteraction[] = req.body.interactions || SYNTHETIC_INTERACTIONS;

      // Batch runs use their own session accumulators and never touch live state
      const result = evaluateDataset(interactions, profiles, (u, q) =>
        globalBaselineTracker.getBaseline(u, q),
      );

      if (persist) {
        const tenant = tenantStampFor(authReq.principal);
        try {
          for (const inter of interactions) {
            const evalRes = result.evaluations[inter.id];
            if (evalRes) {
              insertAuditLog(inter, evalRes, { tenant });
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

  // GET /api/audit-logs - Paginated audit logs for the caller's tenant
  app.get('/api/audit-logs', viewer, (req, res) => {
    try {
      const limit = clampInt(req.query.limit, 50, 1, 500);
      const offset = clampInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
      const logs = getAuditLogs(
        limit,
        offset,
        tenantFilterFor((req as AuthenticatedRequest).principal),
      );
      res.json({ logs, limit, offset });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/audit-logs/verify - Cryptographic HMAC chain integrity verification
  // (the chain spans all tenants, so this is an administrative operation)
  app.get('/api/audit-logs/verify', admin, (_req, res) => {
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
  // Human-In-The-Lead (HITL) Review Decision Endpoints — append-only
  // ──────────────────────────────────────────────────────────────────────

  // GET /api/review-decisions - Query persisted review decisions for the caller's tenant
  app.get('/api/review-decisions', viewer, (req, res) => {
    try {
      const interactionId = req.query.interactionId as string | undefined;
      const decisions = getReviewDecisions(
        interactionId,
        tenantFilterFor((req as AuthenticatedRequest).principal),
      );
      res.json(decisions);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/review-decisions - Append an adjudication decision.
  // Decisions are immutable; a correction is a new decision for the same interaction.
  app.post('/api/review-decisions', reviewer, (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const decision = req.body as ReviewDecision;
      if (
        !decision ||
        typeof decision.id !== 'string' ||
        typeof decision.interaction_id !== 'string' ||
        !REVIEW_ACTIONS.includes(decision.action)
      ) {
        return res.status(400).json({ error: 'Missing or invalid required decision fields' });
      }

      // Gateway escalations belong to a tenant; reviewers may only decide their own
      const escalationJson = getGatewayEscalationEvent(decision.interaction_id);
      if (escalationJson) {
        const escalation = JSON.parse(escalationJson);
        if (
          !tenantMatches(
            tenantFilterFor(authReq.principal),
            escalation.tenantOrgId,
            escalation.tenantWorkspaceId,
          )
        ) {
          return res.status(404).json({ error: 'Interaction not found' });
        }
      }

      // The reviewer is whoever authenticated this request — never a client-supplied name
      const persisted: ReviewDecision = {
        ...decision,
        reviewer: reviewerIdentity(authReq),
        reviewed_at: decision.reviewed_at || new Date().toISOString(),
        notes: decision.notes || '',
      };
      insertReviewDecision(persisted, tenantStampFor(authReq.principal));
      res.json({ status: 'persisted', decision: persisted });
    } catch (error: any) {
      if (error instanceof DuplicateReviewDecisionError) {
        return res.status(409).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // Multi-Tenant API Key Management
  // ──────────────────────────────────────────────────────────────────────

  // POST /api/keys - Create a new API key within the admin's own org
  app.post('/api/keys', admin, (req, res) => {
    try {
      const principal = (req as AuthenticatedRequest).principal!;
      const { workspaceId, description, policyProfile, rateLimitRpm, role } = req.body || {};
      const orgId: string | undefined =
        req.body?.orgId ?? (principal.kind === 'local_dev' ? undefined : principal.orgId);
      if (!orgId) {
        return res.status(400).json({ error: 'orgId is required' });
      }
      if (principal.kind !== 'local_dev' && orgId !== principal.orgId) {
        return res.status(403).json({ error: 'Admins may only create keys for their own org' });
      }
      const keyRole: ApiKeyRole = role ?? 'service';
      if (!API_KEY_ROLES.includes(keyRole)) {
        return res.status(400).json({ error: `role must be one of: ${API_KEY_ROLES.join(', ')}` });
      }
      const keyPolicy = policyProfile || 'support_bot';
      if (!serverPolicyProfiles[keyPolicy]) {
        return res.status(400).json({ error: `Unknown policy profile: ${keyPolicy}` });
      }
      const result = createNewApiKey(
        orgId,
        workspaceId || 'default',
        description || '',
        keyPolicy,
        clampInt(rateLimitRpm, 100, 1, 10_000),
        keyRole,
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
  // Live Gateway Event Stream (bridges proxy → Live Feed + Review Queue)
  // ──────────────────────────────────────────────────────────────────────

  // GET /api/gateway/events/stream — SSE endpoint for the caller's tenant
  app.get('/api/gateway/events/stream', viewer, (req, res) => {
    const filter = tenantFilterFor((req as AuthenticatedRequest).principal);
    if (!addSSEClient(res, filter)) {
      return res.status(503).json({ error: 'Too many event stream subscribers; use polling' });
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial heartbeat
    res.write(': connected\n\n');
    req.on('close', () => removeSSEClient(res));
  });

  // GET /api/gateway/events — Polling endpoint. Pass back `after` (seq) and `epoch`
  // from the previous response; `reset: true` means the cursor was discarded.
  app.get('/api/gateway/events', viewer, (req, res) => {
    res.json(
      getRecentGatewayEvents({
        limit: clampInt(req.query.limit, 50, 1, 500),
        afterSeq: clampInt(req.query.after, 0, 0, Number.MAX_SAFE_INTEGER),
        epoch: typeof req.query.epoch === 'string' ? req.query.epoch : undefined,
        filter: tenantFilterFor((req as AuthenticatedRequest).principal),
      }),
    );
  });

  // GET /api/gateway/escalations — Persisted BLOCK_ESCALATE events with no review decision yet
  app.get('/api/gateway/escalations', viewer, (req, res) => {
    const limit = clampInt(req.query.limit, 100, 1, 500);
    const escalations = getPendingEscalations(
      limit,
      tenantFilterFor((req as AuthenticatedRequest).principal),
    );
    res.json({ escalations, count: escalations.length });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Prometheus Metrics Exporter
  // ──────────────────────────────────────────────────────────────────────

  app.get('/api/metrics', viewer, (_req, res) => {
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

  return {
    app,
    getPolicies: () => serverPolicyProfiles,
    stop: () => watcher?.close(),
  };
}
