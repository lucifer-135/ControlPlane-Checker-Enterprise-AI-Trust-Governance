/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  EvaluationResult,
  PolicyProfile,
  ReviewDecision,
  SyntheticInteraction,
  UseCaseId,
} from './types';
import { SYNTHETIC_INTERACTIONS } from './data/interactions';
import { DEFAULT_POLICY_PROFILES } from './lib/policyProfiles';
import { evaluateDataset } from './lib/decisionEngine';
import {
  fetchInteractionsApi,
  fetchReviewsApi,
  submitReviewDecisionApi,
  clearReviewsApi,
  deleteReviewApi,
  fetchPoliciesApi,
  savePolicyProfileApi,
} from './lib/api';
import { Header } from './components/Header';
import { DashboardTab } from './components/DashboardTab';
import { LiveFeedTab } from './components/LiveFeedTab';
import { ReviewQueueTab } from './components/ReviewQueueTab';
import { PolicyProfilesTab } from './components/PolicyProfilesTab';
import { TrustMetricsTab } from './components/TrustMetricsTab';
import { InteractionTesterModal } from './components/InteractionTesterModal';
import { AmbientShaderBackground } from './components/AmbientShaderBackground';

export function App() {
  // Navigation & View State - Defaults to 'dashboard' overview at start
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'feed' | 'review' | 'policy' | 'metrics'
  >('dashboard');
  const [activeUseCase, setActiveUseCase] = useState<UseCaseId | 'ALL'>('ALL');
  const [policyUseCase, setPolicyUseCase] = useState<UseCaseId>('support_bot');
  const [isTesterOpen, setIsTesterOpen] = useState<boolean>(false);

  // Dynamic Interactions & Policy Profiles State (synced with DB)
  const [interactionsList, setInteractionsList] =
    useState<SyntheticInteraction[]>(SYNTHETIC_INTERACTIONS);
  const [policyProfiles, setPolicyProfiles] =
    useState<Record<UseCaseId, PolicyProfile>>(DEFAULT_POLICY_PROFILES);

  // Frontline Human Review Decisions Store
  const [reviewDecisions, setReviewDecisions] = useState<ReviewDecision[]>([]);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);

  // Load from DB on mount
  useEffect(() => {
    async function loadDataFromDb() {
      try {
        const [fetchedInteractions, fetchedReviews, fetchedPolicies] = await Promise.all([
          fetchInteractionsApi(),
          fetchReviewsApi(),
          fetchPoliciesApi(),
        ]);
        if (fetchedInteractions.interactions && fetchedInteractions.interactions.length > 0) {
          setInteractionsList(fetchedInteractions.interactions);
        }
        if (fetchedReviews && fetchedReviews.length > 0) {
          setReviewDecisions(fetchedReviews);
        }
        if (fetchedPolicies && Object.keys(fetchedPolicies).length > 0) {
          setPolicyProfiles(fetchedPolicies);
        }
      } catch (err) {
        console.warn('Initial DB sync completed with local fallback:', err);
      }
    }
    loadDataFromDb();
  }, []);

  // Real-time evaluation of the interactions dataset against active policy profiles
  const { evaluations } = useMemo(() => {
    return evaluateDataset(interactionsList, policyProfiles);
  }, [interactionsList, policyProfiles]);

  // Update a single policy profile (persisting to DB)
  const handleUpdateProfile = (useCase: UseCaseId, updated: PolicyProfile) => {
    setPolicyProfiles((prev) => ({
      ...prev,
      [useCase]: updated,
    }));
    savePolicyProfileApi(useCase, updated);
  };

  // Stream trigger counter for starting live streaming simulation
  const [streamTrigger, setStreamTrigger] = useState<number>(0);

  const handleNavigateTab = (
    tab: 'dashboard' | 'feed' | 'review' | 'policy' | 'metrics',
    targetId?: string,
    startLiveStream?: boolean,
  ) => {
    setActiveTab(tab);
    if (tab === 'review' && targetId) {
      setSelectedReviewId(targetId);
    }
    if (tab === 'feed' && startLiveStream) {
      setStreamTrigger((prev) => prev + 1);
    }
  };

  // Update Block+Escalate threshold (from Trust Metrics Dial)
  const handleUpdateThreshold = (targetUseCase: UseCaseId | 'ALL', newThreshold: number) => {
    setPolicyProfiles((prev) => {
      let updated: Record<UseCaseId, PolicyProfile>;
      if (targetUseCase === 'ALL') {
        updated = {
          support_bot: {
            ...prev.support_bot,
            thresholds: { ...prev.support_bot.thresholds, block_escalate: newThreshold },
          },
          internal_copilot: {
            ...prev.internal_copilot,
            thresholds: { ...prev.internal_copilot.thresholds, block_escalate: newThreshold },
          },
          decision_support: {
            ...prev.decision_support,
            thresholds: { ...prev.decision_support.thresholds, block_escalate: newThreshold },
          },
        };
        savePolicyProfileApi('support_bot', updated.support_bot);
        savePolicyProfileApi('internal_copilot', updated.internal_copilot);
        savePolicyProfileApi('decision_support', updated.decision_support);
      } else {
        const singleUpdated = {
          ...prev[targetUseCase],
          thresholds: { ...prev[targetUseCase].thresholds, block_escalate: newThreshold },
        };
        updated = {
          ...prev,
          [targetUseCase]: singleUpdated,
        };
        savePolicyProfileApi(targetUseCase, singleUpdated);
      }
      return updated;
    });
  };

  const handleResetProfiles = () => {
    setPolicyProfiles(DEFAULT_POLICY_PROFILES);
    savePolicyProfileApi('support_bot', DEFAULT_POLICY_PROFILES.support_bot);
    savePolicyProfileApi('internal_copilot', DEFAULT_POLICY_PROFILES.internal_copilot);
    savePolicyProfileApi('decision_support', DEFAULT_POLICY_PROFILES.decision_support);
  };

  const handleReviewDecision = (decision: ReviewDecision) => {
    setReviewDecisions((prev) => [decision, ...prev]);
    submitReviewDecisionApi(decision);
  };

  const handleClearReviews = async () => {
    setReviewDecisions([]);
    await clearReviewsApi();
  };

  const handleDeleteReview = async (id: string) => {
    setReviewDecisions((prev) => prev.filter((d) => d.id !== id && d.interaction_id !== id));
    await deleteReviewApi(id);
  };

  // Call Gemini 3.6 Flash LLM Judge via server endpoint
  const handleRunJudge = async (interaction: SyntheticInteraction) => {
    try {
      const resp = await fetch('/api/judge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: interaction.prompt,
          context: interaction.retrieved_context || '',
          retrievedContext: interaction.retrieved_context || '',
          response: interaction.response,
          responseText: interaction.response,
          useCase: interaction.use_case,
        }),
      });

      if (!resp.ok) {
        const errorData = await resp.json();
        throw new Error(errorData.error || 'Judge API error');
      }

      return await resp.json();
    } catch (err: any) {
      console.warn('Judge server request error, utilizing intelligent fallback:', err.message);
      const isConfidentlyWrong =
        interaction.response.toLowerCase().includes('guarantee') ||
        interaction.response.toLowerCase().includes('100%') ||
        interaction.response.toLowerCase().includes('unlimited') ||
        interaction.response.toLowerCase().includes('definitely');

      return {
        isLiveLLM: false,
        verdict: isConfidentlyWrong ? 'CONFIDENTLY_WRONG' : 'UNGROUNDED',
        groundednessScore: isConfidentlyWrong ? 0.15 : 0.35,
        certaintyScore: isConfidentlyWrong ? 0.95 : 0.7,
        certaintySupportMismatch: isConfidentlyWrong ? 0.8 : 0.45,
        reasoning: isConfidentlyWrong
          ? 'Autonomous Governance Evaluator: AI asserts high certainty and absolute claims that contradict the retrieved policy bounds.'
          : 'Autonomous Governance Evaluator: Response contains ungrounded factual assertions unsupported by the reference context.',
        triggeringSpans: [interaction.response.slice(0, 80)],
      };
    }
  };

  // Count pending review items
  const reviewQueueCount = useMemo(() => {
    const reviewedIds = new Set(reviewDecisions.map((d) => d.interaction_id));
    return interactionsList.filter(
      (i) => evaluations[i.id]?.verdict === 'BLOCK_ESCALATE' && !reviewedIds.has(i.id),
    ).length;
  }, [interactionsList, evaluations, reviewDecisions]);

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
        setActiveTab={setActiveTab}
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
              interactions={interactionsList}
              evaluations={evaluations}
              policyProfiles={policyProfiles}
              reviewDecisions={reviewDecisions}
              onNavigateTab={handleNavigateTab}
              onOpenTester={() => setIsTesterOpen(true)}
            />
          )}

          {activeTab === 'feed' && (
            <LiveFeedTab
              interactions={interactionsList}
              evaluations={evaluations}
              onRunJudge={handleRunJudge}
              activeUseCaseFilter={activeUseCase}
              setActiveUseCaseFilter={setActiveUseCase}
              streamTrigger={streamTrigger}
              onStreamTriggerHandled={() => setStreamTrigger(0)}
            />
          )}

          {activeTab === 'review' && (
            <ReviewQueueTab
              interactions={interactionsList}
              evaluations={evaluations}
              reviewDecisions={reviewDecisions}
              onReviewDecision={handleReviewDecision}
              onClearReviews={handleClearReviews}
              onDeleteReview={handleDeleteReview}
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
              interactions={interactionsList}
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
      />

      {/* 4. Footer */}
      <footer className="glass-panel-strong border-t border-slate-200 py-8 text-xs text-[#667085] backdrop-blur-2xl">
        <div className="max-w-[1440px] mx-auto px-6 sm:px-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div
            onClick={() => setActiveTab('dashboard')}
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
              onClick={() => setActiveTab('feed')}
              className="text-[#667085] hover:text-[#101828] transition-colors cursor-pointer font-medium"
            >
              Performance
            </button>
            <button
              onClick={() => setActiveTab('feed')}
              className="text-[#667085] hover:text-[#101828] transition-colors cursor-pointer font-medium"
            >
              Cost
            </button>
            <button
              onClick={() => setActiveTab('feed')}
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
