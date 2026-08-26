/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  EvaluationResult,
  PolicyProfile,
  ReviewDecision,
  SyntheticInteraction,
  UseCaseId,
} from '../types';
import {
  Activity,
  ShieldAlert,
  Sliders,
  BarChart3,
  Shield,
  Zap,
  Layers,
  Clock,
  Play,
  Settings,
  Scale,
  Gauge,
  AlertTriangle,
  ArrowUpRight,
} from 'lucide-react';

interface DashboardTabProps {
  interactions: SyntheticInteraction[];
  evaluations: Record<string, EvaluationResult>;
  policyProfiles: Record<UseCaseId, PolicyProfile>;
  reviewDecisions: ReviewDecision[];
  onNavigateTab: (
    tab: 'dashboard' | 'feed' | 'review' | 'policy' | 'metrics',
    targetId?: string,
    startLiveStream?: boolean
  ) => void;
  onOpenTester: () => void;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  interactions,
  evaluations,
  policyProfiles,
  reviewDecisions,
  onNavigateTab,
  onOpenTester,
}) => {
  // Summary calculations
  const totalInteractions = interactions.length;
  const blockedInteractions = interactions.filter(
    (i) => evaluations[i.id]?.verdict === 'BLOCK_ESCALATE'
  );
  const softCorrectInteractions = interactions.filter(
    (i) => evaluations[i.id]?.verdict === 'SOFT_CORRECT'
  );
  const overlapInteractions = interactions.filter(
    (i) => evaluations[i.id]?.has_multi_lane_overlap
  );

  const pendingReviewCount = blockedInteractions.filter(
    (i) => !reviewDecisions.some((d) => d.interaction_id === i.id)
  ).length;

  const blockRate = totalInteractions > 0
    ? ((blockedInteractions.length / totalInteractions) * 100).toFixed(1)
    : '0.0';

  const avgOverheadMs = totalInteractions > 0
    ? Math.round(
        interactions.reduce(
          (acc, i) => acc + (evaluations[i.id]?.added_overhead_latency_ms || 82),
          0
        ) / totalInteractions
      )
    : 82;

  // Recent high-priority incidents for the preview table
  const recentHighRiskIncidents = interactions
    .filter((i) => evaluations[i.id]?.verdict === 'BLOCK_ESCALATE' || evaluations[i.id]?.has_multi_lane_overlap)
    .slice(0, 4);

  return (
    <div className="flex flex-col gap-14">
      {/* 1. Hero Section */}
      <section className="flex flex-col gap-6 max-w-4xl pt-2">
        <div>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-semibold text-[#101828] tracking-tight leading-[1.05]">
            Enterprise AI Trust &amp; <span className="bg-gradient-to-r from-[#4F46E5] to-[#7C3AED] bg-clip-text text-transparent">Governance</span>
          </h1>
          <p className="text-base sm:text-lg text-[#475467] max-w-2xl leading-relaxed font-sans mt-4">
            Real-time monitoring, multi-lane risk isolation, and autonomous decision routing for mission-critical enterprise AI deployments.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3.5 mt-2">
          <button
            onClick={() => onNavigateTab('feed', undefined, true)}
            className="glass-btn-primary text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center gap-2 cursor-pointer"
          >
            <Play className="h-4 w-4 fill-current" />
            <span>Launch Live Stream</span>
          </button>
          <button
            onClick={onOpenTester}
            className="glass-btn-secondary text-[#344054] hover:text-[#101828] px-5 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center gap-2 cursor-pointer"
          >
            <Settings className="h-4 w-4 text-[#667085]" />
            <span>Interactive Sandbox</span>
          </button>
        </div>
      </section>

      {/* 2. Metrics Grid */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        {/* Metric 1 - Policy Interceptions */}
        <div
          onClick={() => onNavigateTab('feed')}
          className="glass-panel glass-hover rounded-2xl p-6 flex flex-col justify-between cursor-pointer group relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/10 rounded-full blur-2xl pointer-events-none -z-10" />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-2 rounded-xl bg-[#FEF3F2]/80 border border-[#FECDCA] text-[#D92D20]">
                <Shield className="h-4 w-4 shrink-0" />
              </div>
              <h3 className="text-[13px] text-[#475467] font-medium truncate">
                Policy Interceptions
              </h3>
            </div>
            <span className="text-[10px] text-[#B42318] bg-[#FEF3F2]/80 border border-[#FECDCA] px-2 py-0.5 rounded-lg shrink-0 whitespace-nowrap font-semibold">
              High Defense
            </span>
          </div>
          <div className="flex items-baseline gap-2.5 my-4">
            <span className="font-display text-4xl font-semibold text-[#101828] tracking-tight leading-none tnum">
              {blockedInteractions.length}
            </span>
            <span className="font-mono text-xs text-[#D92D20] font-semibold tnum">({blockRate}%)</span>
          </div>
          <p className="text-xs text-[#667085] pt-3 border-t border-slate-200 leading-relaxed">
            <span className="font-mono tnum text-[#475467] font-medium">{totalInteractions}</span> interactions evaluated
          </p>
        </div>

        {/* Metric 2 - Multi-lane Overlaps */}
        <div
          onClick={() => onNavigateTab('feed')}
          className="glass-panel glass-hover rounded-2xl p-6 flex flex-col justify-between cursor-pointer group relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl pointer-events-none -z-10" />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-2 rounded-xl bg-[#FFFAEB]/80 border border-[#FEDF89] text-[#DC6803]">
                <Layers className="h-4 w-4 shrink-0" />
              </div>
              <h3 className="text-[13px] text-[#475467] font-medium truncate">
                Multi-lane Overlaps
              </h3>
            </div>
            <span className="text-[10px] text-[#B54708] bg-[#FFFAEB]/80 border border-[#FEDF89] px-2 py-0.5 rounded-lg shrink-0 whitespace-nowrap font-semibold">
              FR-08 Overlap
            </span>
          </div>
          <div className="flex items-baseline gap-2.5 my-4">
            <span className="font-display text-4xl font-semibold text-[#101828] tracking-tight leading-none tnum">
              {overlapInteractions.length}
            </span>
          </div>
          <p className="text-xs text-[#667085] pt-3 border-t border-slate-200 leading-relaxed">
            Concurrent risk vectors isolated
          </p>
        </div>

        {/* Metric 3 - Review Queue Pending */}
        <div
          onClick={() => onNavigateTab('review')}
          className="glass-panel glass-hover rounded-2xl p-6 flex flex-col justify-between cursor-pointer group relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/10 rounded-full blur-2xl pointer-events-none -z-10" />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-2 rounded-xl bg-[#F4F3FF]/80 border border-[#D9D6FE] text-[#7A5AF8]">
                <ShieldAlert className="h-4 w-4 shrink-0" />
              </div>
              <h3 className="text-[13px] text-[#475467] font-medium truncate">
                Review Queue Pending
              </h3>
            </div>
            <span className="text-[10px] text-[#6941C6] bg-[#F4F3FF]/80 border border-[#D9D6FE] px-2 py-0.5 rounded-lg shrink-0 whitespace-nowrap font-semibold">
              Human Triage
            </span>
          </div>
          <div className="flex items-center gap-2.5 my-4 flex-wrap">
            <span className="font-display text-4xl font-semibold text-[#101828] tracking-tight leading-none tnum">
              {pendingReviewCount}
            </span>
            {pendingReviewCount > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-[#FEF3F2]/90 border border-[#FECDCA] text-[#B42318] shadow-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-[#F04438] animate-pulse"></span>
                <span className="text-[10px] font-semibold whitespace-nowrap">
                  Action Required
                </span>
              </div>
            )}
          </div>
          <p className="text-xs text-[#667085] pt-3 border-t border-slate-200 leading-relaxed">
            <span className="font-mono tnum text-[#475467] font-medium">{reviewDecisions.length}</span> decisions logged in audit
          </p>
        </div>

        {/* Metric 4 - Avg Checker Overhead */}
        <div
          onClick={() => onNavigateTab('metrics')}
          className="glass-panel glass-hover rounded-2xl p-6 flex flex-col justify-between cursor-pointer group relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none -z-10" />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-2 rounded-xl bg-[#ECFDF3]/80 border border-[#ABEFC6] text-[#099250]">
                <Clock className="h-4 w-4 shrink-0" />
              </div>
              <h3 className="text-[13px] text-[#475467] font-medium truncate">
                Avg Checker Overhead
              </h3>
            </div>
            <span className="text-[10px] text-[#067647] bg-[#ECFDF3]/80 border border-[#ABEFC6] px-2 py-0.5 rounded-lg shrink-0 whitespace-nowrap font-semibold">
              &lt;200ms Target
            </span>
          </div>
          <div className="flex items-baseline gap-1.5 my-4">
            <span className="font-display text-4xl font-semibold text-[#101828] tracking-tight leading-none tnum">
              +{avgOverheadMs}
            </span>
            <span className="font-mono text-xs text-[#099250] font-semibold">ms</span>
          </div>
          <p className="text-xs text-[#667085] pt-3 border-t border-slate-200 leading-relaxed">
            High throughput streaming budget
          </p>
        </div>
      </section>

      {/* 3. Governance Modules Section */}
      <section className="flex flex-col gap-5">
        <div className="flex justify-between items-end border-b border-slate-200 pb-3">
          <h2 className="font-headline text-lg text-[#101828] font-semibold tracking-tight flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-[#2E90FA] shadow-[0_0_8px_#2E90FA]"></span>
            Governance Modules &amp; Workflow Gateway
          </h2>
          <span className="text-xs text-[#98A2B3] hidden sm:inline font-medium">Select any module to enter</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Module 1 - Live Inference Stream */}
          <div
            onClick={() => onNavigateTab('feed')}
            className="glass-panel glass-hover rounded-2xl p-6 flex flex-col gap-5 cursor-pointer group"
          >
            <div className="flex items-start gap-4">
              <div className="p-3.5 bg-[#EFF6FF]/90 border border-[#B2DDFF] rounded-xl text-[#175CD3] shadow-xs group-hover:scale-105 transition-transform">
                <Activity className="h-6 w-6" />
              </div>
              <div className="flex-grow min-w-0">
                <h3 className="font-headline text-lg font-semibold text-[#101828] tracking-tight group-hover:text-[#4F46E5] transition-colors">
                  1. Live Inference Stream
                </h3>
                <p className="text-[13px] text-[#667085] mt-1 leading-relaxed font-sans">
                  Real-time telemetry, tripartite risk analysis, and automated Gemini 3.6 tiebreaker judge arbitration.
                </p>
              </div>
            </div>

            <div className="glass-inset rounded-xl p-4 mt-auto space-y-2.5 text-xs">
              <div className="flex justify-between items-center gap-3">
                <span className="text-[#667085]">Stream Coverage</span>
                <span className="text-[#344054] font-medium text-right">Support Bot, Internal Copilot, Decision Support</span>
              </div>
              <div className="flex justify-between items-center pt-2.5 border-t border-slate-200 gap-3">
                <span className="text-[#667085] shrink-0">Autonomous Routing</span>
                <div className="flex flex-wrap gap-1.5 justify-end">
                  <span className="px-2 py-0.5 rounded-md text-[10px] bg-[#ECFDF3]/90 text-[#067647] border border-[#ABEFC6] font-medium shadow-xs">
                    Allow
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] bg-[#EFF6FF]/90 text-[#175CD3] border border-[#B2DDFF] font-medium shadow-xs">
                    Badge
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] bg-[#FFFAEB]/90 text-[#B54708] border border-[#FEDF89] font-medium shadow-xs">
                    Soft-Correct
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] bg-[#FEF3F2]/90 text-[#B42318] border border-[#FECDCA] font-medium shadow-xs">
                    Block
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Module 2 - Frontline Review Queue */}
          <div
            onClick={() => onNavigateTab('review')}
            className="glass-panel glass-hover rounded-2xl p-6 flex flex-col gap-5 cursor-pointer group"
          >
            <div className="flex items-start gap-4">
              <div className="p-3.5 bg-[#FEF3F2]/90 border border-[#FECDCA] rounded-xl text-[#D92D20] shadow-xs group-hover:scale-105 transition-transform">
                <ShieldAlert className="h-6 w-6" />
              </div>
              <div className="flex-grow min-w-0">
                <h3 className="font-headline text-lg font-semibold text-[#101828] tracking-tight group-hover:text-[#4F46E5] transition-colors">
                  2. Frontline Review Queue
                </h3>
                <p className="text-[13px] text-[#667085] mt-1 leading-relaxed font-sans">
                  Human-in-the-loop triage, inline PII redaction editor, and threshold drift calibration feedback loop.
                </p>
              </div>
            </div>

            <div className="glass-inset rounded-xl p-4 mt-auto space-y-2.5 text-xs">
              <div className="flex justify-between items-center gap-3">
                <span className="text-[#667085]">Triage Actions</span>
                <span className="text-[#344054] font-medium text-right">Confirm Block, Sanitize &amp; Allow</span>
              </div>
              <div className="flex justify-between items-center pt-2.5 border-t border-slate-200 gap-3">
                <span className="text-[#667085]">Audit Trail</span>
                <span className="text-[#067647] font-medium text-right">
                  <span className="font-mono tnum">{reviewDecisions.length}</span> decisions logged in session
                </span>
              </div>
            </div>
          </div>

          {/* Module 3 - Governance Policy Studio */}
          <div
            onClick={() => onNavigateTab('policy')}
            className="glass-panel glass-hover rounded-2xl p-6 flex flex-col gap-5 cursor-pointer group"
          >
            <div className="flex items-start gap-4">
              <div className="p-3.5 bg-[#F4F3FF]/90 border border-[#D9D6FE] rounded-xl text-[#6941C6] shadow-xs group-hover:scale-105 transition-transform">
                <Sliders className="h-6 w-6" />
              </div>
              <div className="flex-grow min-w-0">
                <h3 className="font-headline text-lg font-semibold text-[#101828] tracking-tight group-hover:text-[#4F46E5] transition-colors">
                  3. Governance Policy Studio
                </h3>
                <p className="text-[13px] text-[#667085] mt-1 leading-relaxed font-sans">
                  Zero-downtime hot-rescore thresholds, lane weight distributions, and EU AI Act / HIPAA jurisdiction rulesets.
                </p>
              </div>
            </div>

            <div className="glass-inset rounded-xl p-4 mt-auto text-xs">
              <div className="flex justify-between items-center gap-3">
                <span className="text-[#667085] shrink-0">Standard Presets</span>
                <span className="text-[#344054] font-medium text-right">Strict Enterprise, Balanced Standard, High Throughput</span>
              </div>
            </div>
          </div>

          {/* Module 4 - Trust Metrics */}
          <div
            onClick={() => onNavigateTab('metrics')}
            className="glass-panel glass-hover rounded-2xl p-6 flex flex-col gap-5 cursor-pointer group"
          >
            <div className="flex items-start gap-4">
              <div className="p-3.5 bg-[#ECFDF3]/90 border border-[#ABEFC6] rounded-xl text-[#099250] shadow-xs group-hover:scale-105 transition-transform">
                <BarChart3 className="h-6 w-6" />
              </div>
              <div className="flex-grow min-w-0">
                <h3 className="font-headline text-lg font-semibold text-[#101828] tracking-tight group-hover:text-[#4F46E5] transition-colors">
                  4. Trust Metrics &amp; Tradeoff Dial
                </h3>
                <p className="text-[13px] text-[#667085] mt-1 leading-relaxed font-sans">
                  Calibrated dial balancing Alert Fatigue (False Positives) vs Compliance Liability (False Negatives).
                </p>
              </div>
            </div>

            <div className="glass-inset rounded-xl p-4 mt-auto text-xs">
              <div className="flex justify-between items-center gap-3">
                <span className="text-[#667085]">Confusion Matrix</span>
                <span className="text-[#344054] font-medium text-right">Interactive 4-Quadrant Drilldown</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Audit Log Table Section */}
      <section className="flex flex-col gap-4">
        <div className="flex justify-between items-end border-b border-slate-200 pb-3">
          <h2 className="font-headline text-lg text-[#101828] font-semibold tracking-tight flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-[#F04438] shadow-[0_0_8px_#F04438]"></span>
            Recent Governance Interceptions &amp; Violations
          </h2>
          <button
            onClick={() => onNavigateTab('feed')}
            className="text-xs text-[#4F46E5] hover:text-[#4338CA] font-medium transition-colors flex items-center gap-1 cursor-pointer"
          >
            <span>View all in stream</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="w-full overflow-x-auto mt-1 glass-panel rounded-2xl">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100/70 backdrop-blur-md">
                <th className="py-3.5 px-4 text-[11px] text-[#667085] font-semibold whitespace-nowrap">
                  ID
                </th>
                <th className="py-3.5 px-4 text-[11px] text-[#667085] font-semibold whitespace-nowrap">
                  Use Case
                </th>
                <th className="py-3.5 px-4 text-[11px] text-[#667085] font-semibold w-1/3">
                  Prompt Summary
                </th>
                <th className="py-3.5 px-4 text-[11px] text-[#667085] font-semibold">
                  Triggering Violations
                </th>
                <th className="py-3.5 px-4 text-[11px] text-[#667085] font-semibold">
                  Verdict
                </th>
                <th className="py-3.5 px-4 text-[11px] text-[#667085] font-semibold text-right">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="text-sm divide-y divide-slate-200">
              {recentHighRiskIncidents.map((item) => {
                const evalRes = evaluations[item.id];
                if (!evalRes) return null;

                const isBlocked = evalRes.verdict === 'BLOCK_ESCALATE';

                return (
                  <tr
                    key={item.id}
                    className="hover:bg-white/60 transition-colors"
                  >
                    <td className="py-3.5 px-4 font-mono text-xs font-semibold text-[#101828] tnum">
                      {item.id}
                    </td>
                    <td className="py-3.5 px-4 text-[#344054] font-medium whitespace-nowrap font-sans text-xs">
                      {item.use_case === 'decision_support'
                        ? 'Decision Support'
                        : item.use_case === 'internal_copilot'
                        ? 'Internal Copilot'
                        : 'Support Bot'}
                    </td>
                    <td className="py-3.5 px-4 text-[#475467] truncate max-w-[260px] text-xs font-sans">
                      {item.prompt}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] bg-[#FFFAEB]/85 text-[#B54708] border border-[#FEDF89] font-medium shadow-xs">
                        {evalRes.has_multi_lane_overlap
                          ? `Performance (Ungrounded) + Responsibility (${evalRes.overlapping_lanes.join(', ')})`
                          : evalRes.responsibility.pii_detected.length > 0
                          ? `Responsibility (PII: ${evalRes.responsibility.pii_detected[0].type})`
                          : 'Performance (Ungrounded Assertion)'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      {isBlocked ? (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FEF3F2]/85 border border-[#FECDCA] text-[#B42318] w-fit shadow-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#F04438]"></span>
                          <span className="text-[10px] font-semibold">
                            Block + Escalate
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FFFAEB]/85 border border-[#FEDF89] text-[#B54708] w-fit text-[10px] font-medium shadow-xs">
                          <AlertTriangle className="h-3 w-3" />
                          <span>Soft-Correct</span>
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => onNavigateTab('review', item.id)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 glass-btn-secondary rounded-lg text-xs font-semibold text-[#4338CA] hover:text-[#3730A3] hover:bg-indigo-50/80 transition-all cursor-pointer shadow-xs ml-auto group/btn"
                        title={`Inspect interaction ${item.id} in frontline review`}
                      >
                        <span>Inspect</span>
                        <ArrowUpRight className="h-3.5 w-3.5 text-[#4F46E5] group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5 transition-transform" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 5. Pre-Footer Architecture Section */}
      <section className="border-t border-slate-200 pt-8 pb-4 space-y-6">
        <h2 className="font-headline text-lg text-[#101828] tracking-tight flex items-center gap-2.5 font-semibold">
          <Layers className="h-5 w-5 text-[#4F46E5]" />
          Three-Lane Isolated Governance Architecture
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Lane 1 - Performance */}
          <div className="glass-panel glass-hover rounded-2xl p-6 space-y-3 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl pointer-events-none -z-10" />
            <h3 className="text-sm text-[#101828] font-semibold flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-[#EFF6FF] border border-[#B2DDFF] text-[#175CD3]">
                <Zap className="h-4 w-4" />
              </div>
              1. Performance Lane
            </h3>
            <p className="text-[13px] text-[#667085] leading-relaxed font-sans">
              Assesses semantic grounding against retrieved RAG context and calculates the Certainty-Support Mismatch to intercept hallucinated assertions.
            </p>
          </div>

          {/* Lane 2 - Cost & Telemetry */}
          <div className="glass-panel glass-hover rounded-2xl p-6 space-y-3 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl pointer-events-none -z-10" />
            <h3 className="text-sm text-[#101828] font-semibold flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-[#FFFAEB] border border-[#FEDF89] text-[#DC6803]">
                <Gauge className="h-4 w-4" />
              </div>
              2. Cost &amp; Telemetry Lane
            </h3>
            <p className="text-[13px] text-[#667085] leading-relaxed font-sans">
              Tracks token and latency Z-scores against baseline empirical distributions, capturing runaway recursive tool loops and token bloat.
            </p>
          </div>

          {/* Lane 3 - Responsibility */}
          <div className="glass-panel glass-hover rounded-2xl p-6 space-y-3 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/10 rounded-full blur-2xl pointer-events-none -z-10" />
            <h3 className="text-sm text-[#101828] font-semibold flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-[#F4F3FF] border border-[#D9D6FE] text-[#6941C6]">
                <Scale className="h-4 w-4" />
              </div>
              3. Responsibility Lane
            </h3>
            <p className="text-[13px] text-[#667085] leading-relaxed font-sans">
              Scans for sensitive PII entities (SSN, Email, Phone, Credit Cards), demographic bias flags, and regulatory compliance rulesets (EU AI Act, HIPAA).
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
