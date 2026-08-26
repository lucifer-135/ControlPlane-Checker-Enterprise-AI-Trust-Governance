/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  EvaluationResult,
  ReviewDecision,
  SpanHighlight,
  SyntheticInteraction,
  VerdictTier,
} from '../types';
import { VerdictBadge } from './VerdictBadge';
import {
  ShieldAlert,
  ShieldCheck,
  Edit3,
  CheckCircle2,
  AlertTriangle,
  History,
  TrendingUp,
  Layers,
  ArrowRight,
  ClipboardList,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface ReviewQueueTabProps {
  interactions: SyntheticInteraction[];
  evaluations: Record<string, EvaluationResult>;
  reviewDecisions: ReviewDecision[];
  onReviewDecision: (decision: ReviewDecision) => void;
  selectedReviewId?: string | null;
  onClearSelectedReviewId?: () => void;
}

export const ReviewQueueTab: React.FC<ReviewQueueTabProps> = ({
  interactions,
  evaluations,
  reviewDecisions,
  onReviewDecision,
  selectedReviewId,
  onClearSelectedReviewId,
}) => {
  const [includeSoftCorrect, setIncludeSoftCorrect] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedText, setEditedText] = useState<string>('');
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // Auto-expand and scroll to selected ID when navigated from other tabs
  useEffect(() => {
    if (selectedReviewId) {
      const evalRes = evaluations[selectedReviewId];
      if (evalRes && evalRes.verdict === 'SOFT_CORRECT') {
        setIncludeSoftCorrect(true);
      }

      setExpandedId(selectedReviewId);
      setHighlightedId(selectedReviewId);

      const timer = setTimeout(() => {
        const el = document.getElementById(`queue-item-${selectedReviewId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 150);

      const highlightTimer = setTimeout(() => {
        setHighlightedId(null);
      }, 4000);

      return () => {
        clearTimeout(timer);
        clearTimeout(highlightTimer);
      };
    }
  }, [selectedReviewId, evaluations]);

  // Items requiring review
  const escalatedInteractions = interactions.filter((item) => {
    const evalRes = evaluations[item.id];
    if (!evalRes) return false;
    if (includeSoftCorrect) {
      return evalRes.verdict === 'BLOCK_ESCALATE' || evalRes.verdict === 'SOFT_CORRECT';
    }
    return evalRes.verdict === 'BLOCK_ESCALATE';
  });

  const reviewedIds = new Set(reviewDecisions.map((d) => d.interaction_id));
  const pendingInteractions = escalatedInteractions.filter((i) => !reviewedIds.has(i.id));

  // Initialize first item as expanded if none is set yet and not navigating with specific ID
  useEffect(() => {
    if (!expandedId && !selectedReviewId && pendingInteractions.length > 0) {
      setExpandedId(pendingInteractions[0].id);
    }
  }, [pendingInteractions.length]);

  const handleConfirmBlock = (item: SyntheticInteraction, evalRes: EvaluationResult) => {
    const decision: ReviewDecision = {
      id: `dec-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      interaction_id: item.id,
      reviewed_at: new Date().toISOString(),
      reviewer: 'Meera S. (Frontline Compliance Lead)',
      action: 'CONFIRM_BLOCK',
      notes: reviewNotes[item.id] || 'Confirmed high-risk violation; output withheld from end-user.',
      original_verdict: evalRes.verdict,
      new_verdict: 'BLOCK_ESCALATE',
      primary_trigger_lane: evalRes.overlapping_lanes[0] || 'Responsibility',
    };
    onReviewDecision(decision);
  };

  const handleOverrideAllow = (item: SyntheticInteraction, evalRes: EvaluationResult) => {
    const decision: ReviewDecision = {
      id: `dec-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      interaction_id: item.id,
      reviewed_at: new Date().toISOString(),
      reviewer: 'Meera S. (Frontline Compliance Lead)',
      action: 'OVERRIDE_ALLOW',
      notes: reviewNotes[item.id] || 'Reviewer manual override: safe in context / false positive alert.',
      original_verdict: evalRes.verdict,
      new_verdict: 'ALLOW',
      primary_trigger_lane: evalRes.overlapping_lanes[0] || 'Performance',
    };
    onReviewDecision(decision);
  };

  const handleStartEdit = (item: SyntheticInteraction, evalRes: EvaluationResult) => {
    setEditingId(item.id);
    setEditedText(evalRes.responsibility.redacted_response || item.response);
  };

  const handleSaveEditAllow = (item: SyntheticInteraction, evalRes: EvaluationResult) => {
    const decision: ReviewDecision = {
      id: `dec-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      interaction_id: item.id,
      reviewed_at: new Date().toISOString(),
      reviewer: 'Meera S. (Frontline Compliance Lead)',
      action: 'EDIT_ALLOW',
      notes: reviewNotes[item.id] || 'Sanitized response approved (PII redacted / claim corrected).',
      edited_response: editedText,
      original_verdict: evalRes.verdict,
      new_verdict: 'ALLOW',
      primary_trigger_lane: evalRes.overlapping_lanes[0] || 'Responsibility',
    };
    onReviewDecision(decision);
    setEditingId(null);
  };

  // Feedback & Threshold Drift calculations
  const totalReviewed = reviewDecisions.length;
  const totalOverrides = reviewDecisions.filter(
    (d) => d.action === 'OVERRIDE_ALLOW' || d.action === 'EDIT_ALLOW'
  ).length;
  const overrideRate = totalReviewed > 0 ? ((totalOverrides / totalReviewed) * 100).toFixed(1) : '0.0';

  const renderHighlightedResponse = (response: string, evalRes: EvaluationResult) => {
    const spans = [
      ...evalRes.performance.triggering_spans,
      ...evalRes.responsibility.triggering_spans,
    ];

    if (!spans || spans.length === 0) {
      return <span className="text-[#344054] font-mono text-xs leading-relaxed">{response}</span>;
    }

    // Deduplicate and filter out empty spans
    const cleanSpans: SpanHighlight[] = [];
    const seenKeys = new Set<string>();

    for (const s of spans) {
      if (!s || !s.text) continue;
      const trimmed = s.text.trim();
      if (trimmed.length === 0) continue;
      const key = `${trimmed.toLowerCase()}__${s.type}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        cleanSpans.push({ ...s, text: trimmed });
      }
    }

    if (cleanSpans.length === 0) {
      return <span className="text-[#344054] font-mono text-xs leading-relaxed">{response}</span>;
    }

    // Sort by length descending so longer composite phrases match before sub-tokens
    const sortedSpans = [...cleanSpans].sort((a, b) => b.text.length - a.text.length);
    const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const patternParts = sortedSpans.map((s) => {
      const escaped = escapeRegex(s.text);
      if (/^[A-Za-z0-9_]+$/.test(s.text)) {
        return `\\b${escaped}\\b`;
      }
      return escaped;
    });

    const pattern = new RegExp(`(${patternParts.join('|')})`, 'gi');
    const parts = response.split(pattern);

    return (
      <div className="text-xs sm:text-sm leading-relaxed text-[#344054] font-mono">
        {parts.map((part, idx) => {
          if (!part) return null;

          const matchingSpan = sortedSpans.find(
            (s) =>
              s.text.toLowerCase() === part.toLowerCase() ||
              s.text.replace(/[$,]/g, '').toLowerCase() === part.replace(/[$,]/g, '').toLowerCase()
          );

          if (matchingSpan) {
            let bgClass = 'bg-[#FEF3F2] text-[#B42318] border border-[#FECDCA] font-semibold px-1.5 py-0.5 rounded shadow-xs';
            let badgeLabel = 'HALLUCINATION';
            if (matchingSpan.type === 'bias') {
              bgClass = 'bg-[#F4F3FF] text-[#6941C6] border border-[#D9D6FE] font-semibold px-1.5 py-0.5 rounded shadow-xs';
              badgeLabel = 'BIAS / STEREOTYPE';
            } else if (matchingSpan.type === 'pii') {
              bgClass = 'bg-[#FFFAEB] text-[#B54708] border border-[#FEDF89] font-semibold px-1.5 py-0.5 rounded shadow-xs';
              badgeLabel = 'PII EXPOSURE';
            }

            return (
              <mark
                key={idx}
                className={`${bgClass} inline-block mx-0.5 transition-all hover:scale-[1.02] cursor-help`}
                title={`[${badgeLabel}] ${matchingSpan.reason}`}
              >
                {part}
              </mark>
            );
          }
          return <span key={idx}>{part}</span>;
        })}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* 1. Review Queue Header Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: Pending Count */}
        <div className="glass-panel glass-hover rounded-2xl p-6 flex items-center justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/10 rounded-full blur-2xl pointer-events-none -z-10" />
          <div>
            <span className="text-[13px] text-[#475467] block font-medium">
              Escalated items pending review
            </span>
            <div className="mt-2 flex items-baseline space-x-3">
              <span className="font-display text-4xl sm:text-5xl font-semibold text-[#101828] tracking-tight leading-none tnum">
                {pendingInteractions.length}
              </span>
              <span className="font-mono text-xs text-[#667085] tnum">of {escalatedInteractions.length} total</span>
            </div>
            <div className="mt-3.5 pt-3 border-t border-slate-200 flex items-center justify-between gap-3">
              <label className="relative inline-flex items-center gap-2.5 cursor-pointer select-none group">
                <input
                  type="checkbox"
                  checked={includeSoftCorrect}
                  onChange={(e) => setIncludeSoftCorrect(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#4F46E5] transition-colors shadow-inner"></div>
                <span className="text-xs text-[#475467] group-hover:text-[#101828] font-medium transition-colors">
                  Include Soft-Correct items
                </span>
              </label>
              <span
                className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md transition-colors ${
                  includeSoftCorrect
                    ? 'bg-[#EEF0FE] text-[#4F46E5] border border-[#D9D6FE]'
                    : 'bg-slate-100 text-[#667085] border border-slate-200'
                }`}
              >
                {includeSoftCorrect ? 'ON' : 'OFF'}
              </span>
            </div>
          </div>
          <div className="h-12 w-12 rounded-xl bg-[#FEF3F2]/90 border border-[#FECDCA] flex items-center justify-center text-[#D92D20] shrink-0 shadow-xs">
            <ShieldAlert className="h-6 w-6" />
          </div>
        </div>

        {/* Middle: Review Decisions Logged */}
        <div className="glass-panel glass-hover rounded-2xl p-6 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl pointer-events-none -z-10" />
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-[#475467] font-medium">
              Review feedback metrics
            </span>
            <div className="p-1.5 rounded-xl bg-[#EFF6FF] border border-[#B2DDFF]">
              <History className="h-4 w-4 text-[#2E90FA]" />
            </div>
          </div>
          <div className="my-2 grid grid-cols-2 gap-4">
            <div className="glass-inset p-3 rounded-xl">
              <span className="text-[11px] text-[#667085] block font-medium">Total reviewed</span>
              <p className="font-display text-3xl font-semibold text-[#101828] tracking-tight mt-0.5 tnum">{totalReviewed}</p>
            </div>
            <div className="glass-inset p-3 rounded-xl">
              <span className="text-[11px] text-[#667085] block font-medium">Override rate</span>
              <p className="font-display text-3xl font-semibold text-[#B54708] tracking-tight mt-0.5 tnum">{overrideRate}%</p>
            </div>
          </div>
          <p className="text-xs text-[#667085] pt-3 border-t border-slate-200 leading-relaxed">
            {totalOverrides} overrides logged in session audit trail
          </p>
        </div>

        {/* Right: Threshold Drift Analysis Banner */}
        <div className="glass-panel glass-hover rounded-2xl p-6 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none -z-10" />
          <div>
            <div className="flex items-center space-x-2 text-[13px] font-semibold text-[#101828]">
              <div className="p-1.5 rounded-xl bg-[#ECFDF3] border border-[#ABEFC6]">
                <TrendingUp className="h-4 w-4 text-[#12B76A]" />
              </div>
              <span>Threshold drift calibration</span>
            </div>
            <p className="mt-2.5 text-xs text-[#667085] leading-relaxed font-sans">
              {totalOverrides >= 2
                ? 'High override frequency detected in Performance grounding band. Consider tuning the Block+Escalate threshold up by +0.05 in Policy Profiles to mitigate alert fatigue.'
                : 'Current policy profile thresholds align well with frontline triage decisions. All blocked high-risk items represent genuine regulatory/PII violations.'}
            </p>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-200 text-[11px] text-[#067647] font-semibold">
            FR-21 Feedback Store: Active
          </div>
        </div>
      </div>

      {/* 2. Pending Escalated Items List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <h3 className="font-headline text-lg text-[#101828] font-semibold tracking-tight flex items-center">
            <ClipboardList className="h-5 w-5 text-[#D92D20] mr-2" />
            Frontline Human Triage Queue ({pendingInteractions.length} items)
          </h3>
          <span className="text-xs text-[#98A2B3] hidden sm:inline font-medium">
            Reviewer Target: &lt; 60s per escalated interaction
          </span>
        </div>

        {pendingInteractions.length === 0 ? (
          <div className="glass-panel rounded-2xl p-12 text-center">
            <CheckCircle2 className="h-10 w-10 text-[#12B76A] mx-auto mb-3" />
            <p className="text-sm font-semibold text-[#101828]">Review Queue is Completely Clean</p>
            <p className="text-xs text-[#667085] mt-1">
              All escalated items have been triaged or no blocking violations are currently pending.
            </p>
          </div>
        ) : (
          pendingInteractions.map((item) => {
            const evalRes = evaluations[item.id];
            if (!evalRes) return null;

            const isExpanded = expandedId === item.id;
            const isHighlighted = highlightedId === item.id;
            const isEditing = editingId === item.id;

            return (
              <div
                key={item.id}
                id={`queue-item-${item.id}`}
                className={`glass-panel rounded-2xl overflow-hidden transition-all duration-300 border-l-4 ${
                  evalRes.verdict === 'BLOCK_ESCALATE'
                    ? 'border-l-[#F04438]'
                    : 'border-l-[#DC6803]'
                } ${
                  isHighlighted
                    ? 'border-[#4F46E5] ring-4 ring-[#EEF0FE] shadow-lg'
                    : isExpanded
                    ? 'border-[#4F46E5] ring-1 ring-[#4F46E5]/20 shadow-md'
                    : 'hover:border-white'
                }`}
              >
                {/* Item Card Header (Clickable Dropdown Toggle) */}
                <div
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                  className="p-5 cursor-pointer hover:bg-white/50 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 select-none"
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                >
                  {/* Left: Metadata & Prompt Summary */}
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center flex-wrap gap-2.5 text-xs">
                      <span className="font-mono text-sm font-semibold text-[#101828] tnum">{item.id}</span>
                      <span className="px-2.5 py-0.5 rounded-lg glass-inset text-[#344054] font-medium text-[11px]">
                        {item.use_case === 'decision_support'
                          ? 'Decision Support'
                          : item.use_case === 'internal_copilot'
                          ? 'Internal Copilot'
                          : 'Support Bot'}
                      </span>
                      <span className="font-mono text-[#98A2B3] text-xs tnum">{item.session_id}</span>
                      {evalRes.has_multi_lane_overlap && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-[10px] font-medium bg-[#FFFAEB]/85 border border-[#FEDF89] text-[#B54708] shadow-xs">
                          <Layers className="h-3 w-3 mr-1 text-[#DC6803]" />
                          Multi-Lane Overlap
                        </span>
                      )}
                      {isHighlighted && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-[10px] font-semibold bg-[#EEF0FE] text-[#4F46E5] border border-[#D9D6FE] animate-pulse">
                          Inspected Item
                        </span>
                      )}
                    </div>

                    {/* Prompt Preview */}
                    <p className="text-xs text-[#475467] truncate max-w-2xl font-sans">
                      <span className="font-semibold text-[#101828]">Prompt:</span> {item.prompt}
                    </p>
                  </div>

                  {/* Right: Verdict Badge & Dropdown Chevron */}
                  <div className="flex items-center gap-3 shrink-0">
                    <VerdictBadge verdict={evalRes.verdict} size="sm" />
                    <button
                      type="button"
                      className="p-1.5 rounded-lg text-[#98A2B3] hover:text-[#101828] hover:bg-white/60 transition-colors"
                      title={isExpanded ? 'Collapse dropdown' : 'Expand dropdown'}
                      aria-label={isExpanded ? 'Collapse dropdown' : 'Expand dropdown'}
                    >
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Expanded Inspection & Review Section */}
                {isExpanded && (
                  <div className="p-6 pt-4 bg-slate-50/50 border-t border-slate-200 space-y-5 backdrop-blur-md">
                    {/* Violation Reasons Breakdown */}
                    <div className="bg-[#FEF3F2]/85 border border-[#FECDCA] rounded-xl p-4 text-xs space-y-2 shadow-xs">
                      <div className="text-[11px] font-semibold text-[#B42318] flex items-center">
                        <AlertTriangle className="h-3.5 w-3.5 mr-2 text-[#F04438]" />
                        Specific triggering findings across governance lanes
                      </div>
                      <ul className="list-disc list-inside text-[#344054] space-y-1 text-xs font-sans">
                        {evalRes.performance.is_confidently_wrong && (
                          <li>
                            <span className="font-semibold text-[#175CD3]">Performance:</span> Confidently wrong claim detected with {(evalRes.performance.certainty_score * 100).toFixed(0)}% asserted confidence vs {(evalRes.performance.groundedness_score * 100).toFixed(0)}% context support.
                          </li>
                        )}
                        {evalRes.responsibility.pii_detected.length > 0 && (
                          <li>
                            <span className="font-semibold text-[#6941C6]">Responsibility (PII):</span> Disclosed {evalRes.responsibility.pii_detected.length} unredacted sensitive entity instance(s): {evalRes.responsibility.pii_detected.map((p) => p.type).join(', ')}.
                          </li>
                        )}
                        {evalRes.responsibility.bias_flags.length > 0 && (
                          <li>
                            <span className="font-semibold text-[#6941C6]">Responsibility (Bias):</span> {evalRes.responsibility.bias_flags.join(', ')}.
                          </li>
                        )}
                        {evalRes.cost.is_outlier && (
                          <li>
                            <span className="font-semibold text-[#B54708]">Cost:</span> High resource anomaly (Z-Score: {evalRes.cost.combined_z_score}).
                          </li>
                        )}
                      </ul>
                    </div>

                    {/* Dual Inspection: Prompt + Context vs Response */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 text-xs">
                      {/* Left: Prompt & Context */}
                      <div className="space-y-3">
                        <div className="glass-inset rounded-xl p-4">
                          <span className="text-[11px] text-[#667085] block mb-1.5 font-medium">
                            User prompt
                          </span>
                          <p className="text-[#344054] text-sm font-sans">{item.prompt}</p>
                        </div>
                        <div className="glass-inset rounded-xl p-4">
                          <span className="text-[11px] text-[#667085] block mb-1.5 font-medium">
                            Retrieved context (knowledge base)
                          </span>
                          <p className="text-[#475467] italic leading-relaxed text-xs font-sans">
                            {item.retrieved_context || '[No context retrieved]'}
                          </p>
                        </div>
                      </div>

                      {/* Right: AI Response or Editor */}
                      <div className="space-y-3">
                        <div className="glass-inset rounded-xl p-4">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-[11px] text-[#667085] font-medium">
                              AI model response
                            </span>
                            <span className="inline-flex items-center text-[10px] text-[#B42318] font-semibold bg-[#FEF3F2] px-2 py-0.5 rounded-md border border-[#FECDCA]">
                              Withheld
                            </span>
                          </div>

                          {isEditing ? (
                            <div className="space-y-3 mt-2">
                              <textarea
                                value={editedText}
                                onChange={(e) => setEditedText(e.target.value)}
                                rows={5}
                                className="w-full glass-input rounded-xl p-3 text-xs text-[#101828] font-mono placeholder:text-[#98A2B3]"
                                placeholder="Edit the response to sanitize PII or correct hallucinated claims..."
                              />
                              <div className="flex justify-end space-x-2">
                                <button
                                  onClick={() => setEditingId(null)}
                                  className="px-3.5 py-1.5 rounded-xl text-xs font-medium glass-btn-secondary text-[#344054] hover:text-[#101828] cursor-pointer"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => handleSaveEditAllow(item, evalRes)}
                                  className="px-4 py-1.5 rounded-xl text-xs font-medium bg-[#067647] hover:bg-[#055C37] text-white transition-colors shadow-sm cursor-pointer"
                                >
                                  Approve &amp; Dispatch Sanitized
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="bg-white/90 p-3.5 rounded-xl border border-slate-200 shadow-inner">
                              {renderHighlightedResponse(item.response, evalRes)}
                            </div>
                          )}

                          {/* Triggering Violations Legend */}
                          {!isEditing &&
                            (evalRes.performance.triggering_spans.length > 0 ||
                              evalRes.responsibility.triggering_spans.length > 0) && (
                              <div className="pt-2.5 border-t border-slate-200 text-xs space-y-1.5 mt-2">
                                <span className="text-[#667085] font-medium text-[11px] block">
                                  Triggering violations detected in response:
                                </span>
                                <div className="flex flex-wrap gap-1.5">
                                  {evalRes.performance.triggering_spans.map((s, idx) => (
                                    <span
                                      key={`perf-${idx}`}
                                      className="px-2.5 py-0.5 rounded-lg bg-[#FEF3F2] text-[#B42318] border border-[#FECDCA] text-[10px] font-medium shadow-xs"
                                    >
                                      Claim Mismatch: "{s.text}"
                                    </span>
                                  ))}
                                  {evalRes.responsibility.triggering_spans.map((s, idx) => (
                                    <span
                                      key={`resp-${idx}`}
                                      className={`px-2.5 py-0.5 rounded-lg text-[10px] font-medium border shadow-xs ${
                                        s.type === 'pii'
                                          ? 'bg-[#FFFAEB] text-[#B54708] border-[#FEDF89]'
                                          : 'bg-[#F4F3FF] text-[#6941C6] border-[#D9D6FE]'
                                      }`}
                                    >
                                      {s.type.toUpperCase()}: "{s.text}"
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                        </div>

                        {/* Review Notes Input */}
                        <div>
                          <input
                            type="text"
                            placeholder="Optional reviewer notes / feedback rationale..."
                            value={reviewNotes[item.id] || ''}
                            onChange={(e) =>
                              setReviewNotes((prev) => ({ ...prev, [item.id]: e.target.value }))
                            }
                            className="w-full glass-input rounded-xl px-4 py-2.5 text-xs text-[#101828] placeholder:text-[#98A2B3]"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Reviewer Action Bar */}
                    {!isEditing && (
                      <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-200">
                        <span className="text-xs text-[#667085] font-medium">
                          Triage decision for frontline review
                        </span>
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            onClick={() => handleConfirmBlock(item, evalRes)}
                            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-[#B42318] hover:bg-[#912018] text-white transition-all cursor-pointer shadow-xs active:scale-[0.98]"
                          >
                            <ShieldAlert className="h-3.5 w-3.5" />
                            <span>Confirm Block</span>
                          </button>

                          <button
                            onClick={() => handleStartEdit(item, evalRes)}
                            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-medium glass-btn-primary text-white transition-all cursor-pointer"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            <span>Sanitize &amp; Edit</span>
                          </button>

                          <button
                            onClick={() => handleOverrideAllow(item, evalRes)}
                            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-medium glass-btn-secondary text-[#344054] hover:text-[#101828] transition-all cursor-pointer"
                          >
                            <ShieldCheck className="h-3.5 w-3.5 text-[#12B76A]" />
                            <span>Override to Allow</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 3. Decision Audit Log Table */}
      <div className="glass-panel rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3 gap-3">
          <h3 className="font-headline text-lg text-[#101828] font-semibold tracking-tight flex items-center">
            <History className="h-5 w-5 text-[#2E90FA] mr-2.5" />
            Append-Only Review Decision Audit Trail (FR-20 / FR-25)
          </h3>
          <span className="text-xs text-[#667085] whitespace-nowrap font-medium">
            <span className="font-mono tnum text-[#475467] font-semibold">{reviewDecisions.length}</span> recorded decisions
          </span>
        </div>

        {reviewDecisions.length === 0 ? (
          <p className="text-[13px] text-[#667085] py-8 text-center">
            No manual triage decisions recorded yet in this session. Triage items above to populate the audit log.
          </p>
        ) : (
          <div className="overflow-x-auto glass-inset rounded-xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100/70 text-[11px] text-[#667085] font-semibold">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Interaction ID</th>
                  <th className="py-3 px-4">Reviewer</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Verdict Shift</th>
                  <th className="py-3 px-4">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {reviewDecisions.map((d) => (
                  <tr key={d.id} className="hover:bg-white/60 transition-colors">
                    <td className="py-3 px-4 font-mono tnum text-[#667085]">
                      {new Date(d.reviewed_at).toLocaleTimeString()}
                    </td>
                    <td className="py-3 px-4 font-mono tnum font-semibold text-[#101828]">{d.interaction_id}</td>
                    <td className="py-3 px-4 text-[#344054]">{d.reviewer}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2.5 py-0.5 rounded-lg text-[10px] font-medium border shadow-xs ${
                          d.action === 'CONFIRM_BLOCK'
                            ? 'bg-[#FEF3F2]/90 text-[#B42318] border-[#FECDCA]'
                            : d.action === 'EDIT_ALLOW'
                            ? 'bg-[#EEF0FE]/90 text-[#3F3BAF] border-[#D9D6FE]'
                            : 'bg-[#ECFDF3]/90 text-[#067647] border-[#ABEFC6]'
                        }`}
                      >
                        {d.action}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center space-x-2 whitespace-nowrap">
                        <span className="font-mono text-[11px] text-[#B42318] font-semibold">{d.original_verdict}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-[#98A2B3] shrink-0" />
                        <span className="font-mono text-[11px] text-[#067647] font-semibold">{d.new_verdict}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-[#475467] max-w-xs truncate">
                      {d.notes}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
