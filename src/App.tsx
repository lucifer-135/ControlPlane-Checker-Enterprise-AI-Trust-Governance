/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  EvaluationResult,
  PolicyProfile,
  ReviewDecision,
  SyntheticInteraction,
  UseCaseId,
  JudgeProvider,
} from './types';
import { SYNTHETIC_INTERACTIONS } from './data/interactions';
import { DEFAULT_POLICY_PROFILES } from './lib/policyProfiles';
import { evaluateDataset } from './lib/decisionEngine';
import { evaluatePerformanceLane } from './lib/lanes/performanceLane';
import { Header } from './components/Header';
import { DashboardTab } from './components/DashboardTab';
import { LiveFeedTab } from './components/LiveFeedTab';
import { ReviewQueueTab } from './components/ReviewQueueTab';
import { PolicyProfilesTab } from './components/PolicyProfilesTab';
import { TrustMetricsTab } from './components/TrustMetricsTab';
import { InteractionTesterModal } from './components/InteractionTesterModal';
import { AmbientShaderBackground } from './components/AmbientShaderBackground';
import { ApiKeyPrompt } from './components/ApiKeyPrompt';
import { StatusNotice, type Notice } from './components/StatusNotice';
import {
  apiFetch,
  readErrorMessage,
  getStoredApiKey,
  setStoredApiKey,
  AUTH_REQUIRED_EVENT,
} from './lib/apiClient';

interface GatewayEventData {
  interaction: SyntheticInteraction;
  evaluation: EvaluationResult;
  tenantOrgId: string;
  policyProfile: string;
  model: string;
  isStreaming: boolean;
  timestamp: string;
}

const MAX_GATEWAY_EVENTS = 500;

/** Appends new events, de-duplicating by interaction ID and keeping the newest window. */
function mergeGatewayEvents(
  prev: GatewayEventData[],
  incoming: GatewayEventData[],
): GatewayEventData[] {
  const seen = new Set(prev.map((e) => e.interaction.id));
  const combined = [...prev];
  for (const evt of incoming) {
    if (!seen.has(evt.interaction.id)) {
      seen.add(evt.interaction.id);
      combined.push(evt);
    }
  }
  return combined.slice(-MAX_GATEWAY_EVENTS);
}

export function App() {
  // Navigation & View State - Persisted across reloads in sessionStorage
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'feed' | 'review' | 'policy' | 'metrics'
  >(() => {
    try {
      const saved = sessionStorage.getItem('cp_active_tab');
      if (saved && ['dashboard', 'feed', 'review', 'policy', 'metrics'].includes(saved)) {
        return saved as any;
      }
    } catch {}
    return 'dashboard';
  });

  const handleSelectTab = (tab: 'dashboard' | 'feed' | 'review' | 'policy' | 'metrics') => {
    setActiveTab(tab);
    try {
      sessionStorage.setItem('cp_active_tab', tab);
    } catch {}
  };

  const [activeUseCase, setActiveUseCase] = useState<UseCaseId | 'ALL'>('ALL');
  const [policyUseCase, setPolicyUseCase] = useState<UseCaseId>('support_bot');
  const [isTesterOpen, setIsTesterOpen] = useState<boolean>(false);

  // Judge Provider State (Gemini Cloud, Local Qwen 2.5: 7B, or Dual Consensus)
  const [selectedJudgeProvider, setSelectedJudgeProvider] = useState<JudgeProvider>(() => {
    return (localStorage.getItem('cp_judge_provider') as JudgeProvider) || 'gemini';
  });
  const [localLLMStatus, setLocalLLMStatus] = useState<{
    available: boolean;
    installed: boolean;
    endpoint: string;
    model: string;
  }>({
    available: false,
    installed: false,
    endpoint: 'http://localhost:11434',
    model: 'qwen2.5:7b',
  });

  // ──────────────────────────────────────────────────────────────────────
  // Authentication — API key prompt when the server requires auth
  // ──────────────────────────────────────────────────────────────────────

  // Bumped after the operator enters a key, so data loaders re-run
  const [authVersion, setAuthVersion] = useState<number>(0);
  const [isKeyPromptOpen, setIsKeyPromptOpen] = useState<boolean>(false);

  useEffect(() => {
    const onAuthRequired = () => setIsKeyPromptOpen(true);
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, []);

  const handleSubmitApiKey = (key: string) => {
    setStoredApiKey(key.trim() || null);
    setIsKeyPromptOpen(false);
    setAuthVersion((v) => v + 1);
  };

  // Query /api/health to discover auth mode and local LLM status (public endpoint)
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((data) => {
        if (data.localLLM) {
          setLocalLLMStatus(data.localLLM);
        }
        if (data.authMode === 'required' && !getStoredApiKey()) {
          setIsKeyPromptOpen(true);
        }
      })
      .catch((err) => console.warn('Health probe failed:', err));
  }, []);

  // ──────────────────────────────────────────────────────────────────────
  // Status notices (policy saves, review decision failures)
  // ──────────────────────────────────────────────────────────────────────

  const [notice, setNotice] = useState<Notice>({ state: 'idle' });

  useEffect(() => {
    if (notice.state !== 'saved') return;
    const timer = setTimeout(() => setNotice({ state: 'idle' }), 2000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Policy Profiles State — initialized from server (persisted YAML)
  const [policyProfiles, setPolicyProfiles] =
    useState<Record<UseCaseId, PolicyProfile>>(DEFAULT_POLICY_PROFILES);
  // Latest profiles, read by debounced persistence when its timer fires
  const policyProfilesRef = useRef(policyProfiles);

  const replaceProfiles = (profiles: Record<UseCaseId, PolicyProfile>) => {
    policyProfilesRef.current = profiles;
    setPolicyProfiles(profiles);
  };

  // Load policies from server on mount (bridges Policy Studio → live gateway)
  useEffect(() => {
    apiFetch('/api/policies')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data === 'object' && Object.keys(data).length > 0) {
          replaceProfiles(data);
        }
      })
      .catch(() => {
        console.warn('Could not load server policies, using defaults');
      });
  }, [authVersion]);

  // Frontline Human Review Decisions Store
  const [reviewDecisions, setReviewDecisions] = useState<ReviewDecision[]>([]);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);

  // Server-side evaluation of the synthetic dataset (simulation only — never audited)
  const [evaluations, setEvaluations] = useState<Record<string, EvaluationResult>>({});
  const evalAbortRef = useRef<AbortController | null>(null);

  const fetchEvaluations = useCallback(async (profiles: Record<UseCaseId, PolicyProfile>) => {
    // Only the latest request may update state
    evalAbortRef.current?.abort();
    const controller = new AbortController();
    evalAbortRef.current = controller;
    try {
      const resp = await apiFetch('/api/evaluate/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profiles, persist: false }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (resp.ok) {
        const data = await resp.json();
        if (!controller.signal.aborted) setEvaluations(data.evaluations);
      } else {
        // Fallback to client-side evaluation if server is unavailable
        console.warn('Server evaluation unavailable, falling back to client-side');
        setEvaluations(evaluateDataset(SYNTHETIC_INTERACTIONS, profiles).evaluations);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return;
      // Fallback to client-side evaluation on network error
      console.warn('Server unreachable, falling back to client-side evaluation:', err);
      setEvaluations(evaluateDataset(SYNTHETIC_INTERACTIONS, profiles).evaluations);
    }
  }, []);

  // Re-evaluate when policy profiles change — debounced so slider drags
  // produce one request after the user pauses, not one per pixel
  useEffect(() => {
    const timer = setTimeout(() => fetchEvaluations(policyProfiles), 300);
    return () => clearTimeout(timer);
  }, [policyProfiles, fetchEvaluations, authVersion]);

  // ──────────────────────────────────────────────────────────────────────
  // Policy mutations — the single path for every profile change
  // ──────────────────────────────────────────────────────────────────────

  const persistTimersRef = useRef<Partial<Record<UseCaseId, ReturnType<typeof setTimeout>>>>({});
  const inFlightSavesRef = useRef<number>(0);

  const persistProfile = useCallback(async (useCase: UseCaseId) => {
    const profile = policyProfilesRef.current[useCase];
    if (!profile) return;
    inFlightSavesRef.current += 1;
    setNotice({ state: 'saving', message: 'Saving policy…' });
    try {
      const resp = await apiFetch(`/api/policies/${encodeURIComponent(useCase)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      if (!resp.ok) {
        throw new Error(await readErrorMessage(resp));
      }
      inFlightSavesRef.current -= 1;
      if (inFlightSavesRef.current === 0) {
        setNotice({ state: 'saved', message: 'Policy saved' });
      }
    } catch (err: any) {
      inFlightSavesRef.current -= 1;
      setNotice({
        state: 'error',
        message: `Could not save ${profile.name || useCase}: ${err?.message || err}`,
      });
    }
  }, []);

  /**
   * Applies a profile mutation to local state immediately (smooth slider drags)
   * and schedules a debounced save for every use case whose profile changed.
   */
  const updateProfiles = useCallback(
    (mutate: (prev: Record<UseCaseId, PolicyProfile>) => Record<UseCaseId, PolicyProfile>) => {
      const prev = policyProfilesRef.current;
      const next = mutate(prev);
      policyProfilesRef.current = next;
      setPolicyProfiles(next);

      for (const useCase of Object.keys(next) as UseCaseId[]) {
        if (next[useCase] === prev[useCase]) continue;
        const existing = persistTimersRef.current[useCase];
        if (existing) clearTimeout(existing);
        persistTimersRef.current[useCase] = setTimeout(() => {
          delete persistTimersRef.current[useCase];
          persistProfile(useCase);
        }, 400);
      }
    },
    [persistProfile],
  );

  // Update a single policy profile (Policy Studio)
  const handleUpdateProfile = (useCase: UseCaseId, updated: PolicyProfile) => {
    updateProfiles((prev) => ({ ...prev, [useCase]: updated }));
  };

  // Update Block+Escalate threshold (Trust Metrics Dial) — persisted like any other edit
  const handleUpdateThreshold = (targetUseCase: UseCaseId | 'ALL', newThreshold: number) => {
    updateProfiles((prev) => {
      const targets =
        targetUseCase === 'ALL' ? (Object.keys(prev) as UseCaseId[]) : [targetUseCase];
      const next = { ...prev };
      for (const useCase of targets) {
        if (prev[useCase].thresholds.block_escalate === newThreshold) continue;
        next[useCase] = {
          ...prev[useCase],
          thresholds: { ...prev[useCase].thresholds, block_escalate: newThreshold },
        };
      }
      return next;
    });
  };

  // Stream trigger counter for starting live streaming simulation
  const [streamTrigger, setStreamTrigger] = useState<number>(0);

  const handleNavigateTab = (
    tab: 'dashboard' | 'feed' | 'review' | 'policy' | 'metrics',
    targetId?: string,
    startLiveStream?: boolean,
  ) => {
    handleSelectTab(tab);
    if (tab === 'review' && targetId) {
      setSelectedReviewId(targetId);
    }
    if (tab === 'feed' && startLiveStream) {
      setStreamTrigger((prev) => prev + 1);
    }
  };

  const handleResetProfiles = async () => {
    // Pending debounced saves would overwrite the reset
    for (const useCase of Object.keys(persistTimersRef.current) as UseCaseId[]) {
      clearTimeout(persistTimersRef.current[useCase]);
    }
    persistTimersRef.current = {};
    try {
      const res = await apiFetch('/api/policies/reset', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data?.profiles) {
          replaceProfiles(data.profiles);
          setNotice({ state: 'saved', message: 'Policies reset to defaults' });
          return;
        }
      }
      setNotice({
        state: 'error',
        message: `Could not reset policies: ${res.ok ? 'unexpected response' : await readErrorMessage(res)}`,
      });
    } catch (err: any) {
      setNotice({ state: 'error', message: `Could not reset policies: ${err?.message || err}` });
    }
  };

  // ──────────────────────────────────────────────────────────────────────
  // Live Gateway Events — poll real proxy traffic for Live Feed + Review Queue
  // ──────────────────────────────────────────────────────────────────────

  const [gatewayEvents, setGatewayEvents] = useState<GatewayEventData[]>([]);
  const [pendingEscalations, setPendingEscalations] = useState<GatewayEventData[]>([]);
  // Cursor into the server's event sequence. The epoch identifies the server
  // process; a restart resets sequence numbers, and the server reports `reset`.
  const eventCursorRef = useRef<{ seq: number; epoch: string }>({ seq: 0, epoch: '' });

  useEffect(() => {
    let cancelled = false;
    const pollGatewayEvents = async () => {
      try {
        const { seq, epoch } = eventCursorRef.current;
        const params = new URLSearchParams({ limit: '100', after: String(seq) });
        if (epoch) params.set('epoch', epoch);
        const resp = await apiFetch(`/api/gateway/events?${params.toString()}`);
        if (!resp.ok || cancelled) return;
        const data = await resp.json();
        // Advance the cursor on every successful response, including empty ones
        eventCursorRef.current = {
          seq: typeof data.currentSeq === 'number' ? data.currentSeq : 0,
          epoch: typeof data.epoch === 'string' ? data.epoch : '',
        };
        if (Array.isArray(data.events) && data.events.length > 0) {
          setGatewayEvents((prev) => mergeGatewayEvents(prev, data.events));
        }
      } catch {
        // Polling failed, retry next interval
      }
    };

    pollGatewayEvents();
    const interval = setInterval(pollGatewayEvents, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [authVersion]);

  // Durable escalations awaiting review (survive server restarts and event-buffer eviction)
  useEffect(() => {
    let cancelled = false;
    const loadEscalations = async () => {
      try {
        const resp = await apiFetch('/api/gateway/escalations?limit=200');
        if (!resp.ok || cancelled) return;
        const data = await resp.json();
        if (Array.isArray(data.escalations)) setPendingEscalations(data.escalations);
      } catch {
        // Retry next interval
      }
    };
    loadEscalations();
    const interval = setInterval(loadEscalations, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [authVersion]);

  // Load persisted review decisions from server SQLite on mount
  useEffect(() => {
    apiFetch('/api/review-decisions')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (Array.isArray(data)) {
          setReviewDecisions(data);
        }
      })
      .catch(() => {});
  }, [authVersion]);

  const handleReviewDecision = async (decision: ReviewDecision) => {
    setReviewDecisions((prev) => [decision, ...prev]);
    try {
      const resp = await apiFetch('/api/review-decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(decision),
      });
      if (!resp.ok) {
        throw new Error(await readErrorMessage(resp));
      }
      // Show the decision as persisted, including the server-assigned reviewer identity
      const data = await resp.json();
      if (data?.decision) {
        setReviewDecisions((prev) =>
          prev.map((d) => (d.id === decision.id ? { ...d, ...data.decision } : d)),
        );
      }
    } catch (err: any) {
      // Roll back the optimistic entry so the UI reflects the audit trail
      setReviewDecisions((prev) => prev.filter((d) => d.id !== decision.id));
      setNotice({
        state: 'error',
        message: `Review decision was not recorded: ${err?.message || err}`,
      });
    }
  };

  // Call LLM Judge (Gemini, Local Qwen 2.5: 7B, or Dual Consensus) via server endpoint
  const handleRunJudge = async (
    interaction: SyntheticInteraction,
    provider: JudgeProvider = selectedJudgeProvider,
  ) => {
    try {
      const resp = await apiFetch('/api/judge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: interaction.prompt,
          context: interaction.retrieved_context || '',
          retrievedContext: interaction.retrieved_context || '',
          response: interaction.response,
          responseText: interaction.response,
          useCase: interaction.use_case,
          provider,
        }),
      });

      if (!resp.ok) {
        throw new Error(await readErrorMessage(resp));
      }

      return await resp.json();
    } catch (err: any) {
      console.warn('Judge server request error, utilizing intelligent fallback:', err.message);
      const perf = evaluatePerformanceLane(
        interaction.prompt,
        interaction.retrieved_context,
        interaction.response,
        interaction.use_case,
      );

      let verdict: 'SUPPORTED' | 'AMBIGUOUS' | 'CONFIDENTLY_WRONG' | 'UNSUPPORTED' = 'SUPPORTED';
      if (perf.is_confidently_wrong) {
        verdict = 'CONFIDENTLY_WRONG';
      } else if (perf.groundedness_score < 0.4) {
        verdict = 'UNSUPPORTED';
      } else if (perf.is_ambiguous) {
        verdict = 'AMBIGUOUS';
      }

      let reasoning =
        'Autonomous Governance Evaluator: The response is verified and consistent with reference context bounds.';
      if (verdict === 'CONFIDENTLY_WRONG') {
        reasoning = `Autonomous Governance Evaluator: Assertion certainty bounds mismatch. The AI asserts high certainty that contradicts or fabricates claims beyond context (${perf.explanation}).`;
      } else if (verdict === 'UNSUPPORTED') {
        reasoning = `Autonomous Governance Evaluator: Response contains ungrounded assertions not substantiated by context (${perf.explanation}).`;
      } else if (verdict === 'AMBIGUOUS') {
        reasoning = `Autonomous Governance Evaluator: Borderline grounding support observed with partial context alignment (${perf.explanation}).`;
      }

      return {
        isLiveLLM: false,
        modelUsed: 'autonomous-evaluator-fallback',
        verdict,
        groundednessScore: Number(perf.groundedness_score.toFixed(2)),
        certaintyScore: Number(perf.certainty_score.toFixed(2)),
        certaintySupportMismatch: Number(perf.certainty_support_mismatch.toFixed(2)),
        reasoning,
        triggeringSpans: perf.triggering_spans.map((s) => s.text),
      };
    }
  };

  // Live gateway traffic: recent events plus durable escalations, de-duplicated by ID
  const gatewayInteractionData = useMemo(() => {
    const byId = new Map<string, GatewayEventData>();
    for (const evt of [...pendingEscalations, ...gatewayEvents]) {
      byId.set(evt.interaction.id, evt);
    }
    const syntheticIds = new Set(SYNTHETIC_INTERACTIONS.map((i) => i.id));
    return Array.from(byId.values())
      .filter((e) => !syntheticIds.has(e.interaction.id))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [gatewayEvents, pendingEscalations]);

  const liveInteractions = useMemo(
    () => gatewayInteractionData.map((e) => e.interaction),
    [gatewayInteractionData],
  );

  // Synthetic evaluations are recomputed on policy changes; gateway evaluations
  // are kept separately so a re-evaluation never drops live traffic.
  const allEvaluations = useMemo(() => {
    const merged = { ...evaluations };
    for (const evt of gatewayInteractionData) {
      merged[evt.interaction.id] = evt.evaluation;
    }
    return merged;
  }, [evaluations, gatewayInteractionData]);

  // Merge synthetic + live gateway interactions for the Review Queue
  const allInteractions = useMemo(
    () => [...SYNTHETIC_INTERACTIONS, ...liveInteractions],
    [liveInteractions],
  );

  // Count pending review items (includes gateway escalations)
  const reviewQueueCount = useMemo(() => {
    const reviewedIds = new Set(reviewDecisions.map((d) => d.interaction_id));
    return allInteractions.filter(
      (i) => allEvaluations[i.id]?.verdict === 'BLOCK_ESCALATE' && !reviewedIds.has(i.id),
    ).length;
  }, [allEvaluations, reviewDecisions, allInteractions]);

  // Prevent vertical scroll jumping when switching sections
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [activeTab]);

  return (
    <div className="min-h-screen text-[#101828] flex flex-col font-sans selection:bg-indigo-100 selection:text-indigo-900 relative">
      {/* 0. Ambient WebGL Background */}
      <AmbientShaderBackground />

      {/* 1. Top Navigation Bar */}
      <Header
        activeTab={activeTab}
        setActiveTab={handleSelectTab}
        reviewQueueCount={reviewQueueCount}
        onOpenTester={() => setIsTesterOpen(true)}
        hasApiKey={true}
        activeProfileName={policyProfiles[policyUseCase]?.name || policyUseCase}
      />

      {/* 2. Main Content Canvas */}
      <main className="flex-grow w-full max-w-[1440px] mx-auto px-6 sm:px-8 py-8 min-h-[75vh]">
        <div key={activeTab} className="animate-in fade-in duration-150">
          {activeTab === 'dashboard' && (
            <DashboardTab
              interactions={SYNTHETIC_INTERACTIONS}
              evaluations={evaluations}
              policyProfiles={policyProfiles}
              reviewDecisions={reviewDecisions}
              onNavigateTab={handleNavigateTab}
              onOpenTester={() => setIsTesterOpen(true)}
            />
          )}

          {activeTab === 'feed' && (
            <LiveFeedTab
              interactions={SYNTHETIC_INTERACTIONS}
              liveInteractions={liveInteractions}
              evaluations={allEvaluations}
              onRunJudge={handleRunJudge}
              activeUseCaseFilter={activeUseCase}
              setActiveUseCaseFilter={setActiveUseCase}
              streamTrigger={streamTrigger}
              onStreamTriggerHandled={() => setStreamTrigger(0)}
              judgeProvider={selectedJudgeProvider}
              onSelectJudgeProvider={(p) => {
                setSelectedJudgeProvider(p);
                try {
                  localStorage.setItem('cp_judge_provider', p);
                } catch {}
              }}
              localLLMStatus={localLLMStatus}
            />
          )}

          {activeTab === 'review' && (
            <ReviewQueueTab
              interactions={allInteractions}
              evaluations={allEvaluations}
              reviewDecisions={reviewDecisions}
              onReviewDecision={handleReviewDecision}
              selectedReviewId={selectedReviewId}
              onClearSelectedReviewId={() => setSelectedReviewId(null)}
            />
          )}

          {activeTab === 'policy' && (
            <PolicyProfilesTab
              policyProfiles={policyProfiles}
              onUpdateProfile={handleUpdateProfile}
              onResetProfiles={handleResetProfiles}
              activeUseCase={policyUseCase}
              setActiveUseCase={setPolicyUseCase}
            />
          )}

          {activeTab === 'metrics' && (
            <TrustMetricsTab
              interactions={SYNTHETIC_INTERACTIONS}
              evaluations={evaluations}
              policyProfiles={policyProfiles}
              onUpdateThreshold={handleUpdateThreshold}
              activeUseCase={activeUseCase}
              setActiveUseCase={setActiveUseCase}
            />
          )}
        </div>
      </main>

      {/* 3. Interactive Sandbox Modal */}
      <InteractionTesterModal
        isOpen={isTesterOpen}
        onClose={() => setIsTesterOpen(false)}
        policyProfiles={policyProfiles}
        onRunJudge={handleRunJudge}
        judgeProvider={selectedJudgeProvider}
        onSelectJudgeProvider={(p) => {
          setSelectedJudgeProvider(p);
          try {
            localStorage.setItem('cp_judge_provider', p);
          } catch {}
        }}
        localLLMStatus={localLLMStatus}
      />

      {/* 4. Save / error status and API key prompt */}
      <StatusNotice notice={notice} onDismiss={() => setNotice({ state: 'idle' })} />
      <ApiKeyPrompt
        isOpen={isKeyPromptOpen}
        hasStoredKey={Boolean(getStoredApiKey())}
        onSubmit={handleSubmitApiKey}
        onClose={() => setIsKeyPromptOpen(false)}
      />

      {/* 5. Footer */}
      <footer className="glass-panel-strong border-t border-slate-200 py-8 text-xs text-[#667085] backdrop-blur-2xl">
        <div className="max-w-[1440px] mx-auto px-6 sm:px-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div
            onClick={() => handleSelectTab('dashboard')}
            className="flex items-center gap-2.5 cursor-pointer select-none group"
          >
            <span className="font-headline font-semibold text-[#101828] text-sm tracking-tight group-hover:text-[#4F46E5] transition-colors">
              ControlPlane Checker
            </span>
            <span className="text-[#98A2B3] hidden sm:inline">
              © Enterprise AI Trust &amp; Governance Control Plane
            </span>
          </div>

          <div className="flex items-center gap-6 flex-wrap justify-center">
            <button
              onClick={() => handleSelectTab('feed')}
              className="text-[#667085] hover:text-[#101828] transition-colors cursor-pointer font-medium"
            >
              Performance
            </button>
            <button
              onClick={() => handleSelectTab('feed')}
              className="text-[#667085] hover:text-[#101828] transition-colors cursor-pointer font-medium"
            >
              Cost
            </button>
            <button
              onClick={() => handleSelectTab('feed')}
              className="text-[#667085] hover:text-[#101828] transition-colors cursor-pointer font-medium"
            >
              Responsibility
            </button>
            <div className="flex items-center gap-2 border-l border-slate-200 pl-6">
              <span className="w-1.5 h-1.5 rounded-full bg-[#12B76A]"></span>
              <span className="font-mono text-[11px] text-[#475467] tnum font-semibold">
                Operational
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
