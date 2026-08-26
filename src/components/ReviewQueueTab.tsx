/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { EvaluationResult, ReviewDecision, SpanHighlight, SyntheticInteraction } from '../types';
import { VerdictBadge } from './VerdictBadge';
import {
  ShieldAlert,
  ShieldCheck,
  Edit3,
  CheckCircle2,
  History,
  TrendingUp,
  Layers,
  ArrowRight,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Trash2,
  Check,
} from 'lucide-react';

interface ReviewQueueTabProps {
  interactions: SyntheticInteraction[];
  evaluations: Record<string, EvaluationResult>;
  reviewDecisions: ReviewDecision[];
  onReviewDecision: (decision: ReviewDecision) => void;
  onClearReviews?: () => void;
  onDeleteReview?: (id: string) => void;
  selectedReviewId?: string | null;
  onClearSelectedReviewId?: () => void;
}

export const ReviewQueueTab: React.FC<ReviewQueueTabProps> = ({
  interactions,
  evaluations,
  reviewDecisions,
  onReviewDecision,
  onClearReviews,
  onDeleteReview,
  selectedReviewId,
}) => {
  const [includeSoftCorrect, setIncludeSoftCorrect] = useState<boolean>(false);
  const [viewFilter, setViewFilter] = useState<'pending' | 'all' | 'triaged'>('pending');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedText, setEditedText] = useState<string>('');
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

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
  const escalatedInteractions = useMemo(() => {
    return interactions.filter((item) => {
      const evalRes = evaluations[item.id];
      if (!evalRes) return false;
      if (includeSoftCorrect) {
        return evalRes.verdict === 'BLOCK_ESCALATE' || evalRes.verdict === 'SOFT_CORRECT';
      }
      return evalRes.verdict === 'BLOCK_ESCALATE';
    });
  }, [interactions, evaluations, includeSoftCorrect]);

  const reviewedMap = useMemo(() => {
    const map = new Map<string, ReviewDecision>();
    for (const d of reviewDecisions) {
      map.set(d.interaction_id, d);
    }
    return map;
  }, [reviewDecisions]);

  const pendingInteractions = useMemo(() => {
    return escalatedInteractions.filter((i) => !reviewedMap.has(i.id));
  }, [escalatedInteractions, reviewedMap]);

  const triagedInteractions = useMemo(() => {
    return escalatedInteractions.filter((i) => reviewedMap.has(i.id));
  }, [escalatedInteractions, reviewedMap]);

  // Display list based on viewFilter
  const displayedInteractions = useMemo(() => {
    if (viewFilter === 'pending') return pendingInteractions;
    if (viewFilter === 'triaged') return triagedInteractions;
    return escalatedInteractions;
  }, [viewFilter, pendingInteractions, triagedInteractions, escalatedInteractions]);

  // Initialize first item as expanded if none is set yet and not navigating with specific ID
  useEffect(() => {
    if (!expandedId && !selectedReviewId && displayedInteractions.length > 0) {
      setExpandedId(displayedInteractions[0].id);
    }
  }, [displayedInteractions, expandedId, selectedReviewId]);

  const handleConfirmBlock = (item: SyntheticInteraction, evalRes: EvaluationResult) => {
    const decision: ReviewDecision = {
      id: `dec-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      interaction_id: item.id,
      reviewed_at: new Date().toISOString(),
      reviewer: 'Meera S. (Frontline Compliance Lead)',
      action: 'CONFIRM_BLOCK',
      notes:
        reviewNotes[item.id] || 'Confirmed high-risk violation; output withheld from end-user.',
      original_verdict: evalRes.verdict,
      new_verdict: 'BLOCK_ESCALATE',
      primary_trigger_lane: evalRes.overlapping_lanes[0] || 'Responsibility',
    };
    onReviewDecision(decision);
    showToast(`Adjudicated ${item.id}: Block Confirmed`);
  };

  const handleOverrideAllow = (item: SyntheticInteraction, evalRes: EvaluationResult) => {
    const decision: ReviewDecision = {
      id: `dec-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      interaction_id: item.id,
      reviewed_at: new Date().toISOString(),
      reviewer: 'Meera S. (Frontline Compliance Lead)',
      action: 'OVERRIDE_ALLOW',
      notes:
        reviewNotes[item.id] || 'Reviewer manual override: safe in context / false positive alert.',
      original_verdict: evalRes.verdict,
      new_verdict: 'ALLOW',
      primary_trigger_lane: evalRes.overlapping_lanes[0] || 'Performance',
    };
    onReviewDecision(decision);
    showToast(`Adjudicated ${item.id}: Overridden to ALLOW`);
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
      notes:
        reviewNotes[item.id] || 'Sanitized response approved (PII redacted / claim corrected).',
      edited_response: editedText,
      original_verdict: evalRes.verdict,
      new_verdict: 'ALLOW',
      primary_trigger_lane: evalRes.overlapping_lanes[0] || 'Responsibility',
    };
    onReviewDecision(decision);
    setEditingId(null);
    showToast(`Adjudicated ${item.id}: Sanitized & Released`);
  };

  const handleResetSession = () => {
    if (onClearReviews) {
      onClearReviews();
      showToast('Review session reset: all items restored to pending triage queue');
    }
  };

  const handleReopenItem = (interactionId: string) => {
    if (onDeleteReview) {
      onDeleteReview(interactionId);
      showToast(`Reopened interaction ${interactionId} back to pending review`);
    }
  };

  // Feedback & Threshold Drift calculations
  const totalReviewed = reviewDecisions.length;
  const totalOverrides = reviewDecisions.filter(
    (d) => d.action === 'OVERRIDE_ALLOW' || d.action === 'EDIT_ALLOW',
  ).length;
  const overrideRate =
    totalReviewed > 0 ? ((totalOverrides / totalReviewed) * 100).toFixed(1) : '0.0';

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
              s.text.replace(/[$,]/g, '').toLowerCase() === part.replace(/[$,]/g, '').toLowerCase(),
          );

          if (matchingSpan) {
            let bgClass =
              'bg-[#FEF3F2] text-[#B42318] border border-[#FECDCA] font-semibold px-1.5 py-0.5 rounded shadow-xs';
            let badgeLabel = 'HALLUCINATION';
            if (matchingSpan.type === 'bias') {
              bgClass =
                'bg-[#F4F3FF] text-[#6941C6] border border-[#D9D6FE] font-semibold px-1.5 py-0.5 rounded shadow-xs';
              badgeLabel = 'BIAS / STEREOTYPE';
            } else if (matchingSpan.type === 'pii') {
              bgClass =
                'bg-[#FFFAEB] text-[#B54708] border border-[#FEDF89] font-semibold px-1.5 py-0.5 rounded shadow-xs';
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
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 glass-panel bg-white/95 border border-indigo-200 text-[#101828] px-4 py-3 rounded-2xl shadow-xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="p-1 rounded-full bg-emerald-100 text-emerald-600">
            <Check className="h-4 w-4" />
          </div>
          <span className="text-xs font-semibold">{toastMessage}</span>
        </div>
      )}

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
              <span className="font-mono text-xs text-[#667085] tnum">
                of {escalatedInteractions.length} total
              </span>
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
            <span className="text-[13px] text-[#475467] font-medium">Review session metrics</span>
            <div className="flex items-center gap-2">
              {reviewDecisions.length > 0 && onClearReviews && (
                <button
                  onClick={handleResetSession}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Clear review session and restore all items to pending queue"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Reset Session</span>
                </button>
              )}
              <div className="p-1.5 rounded-xl bg-[#EFF6FF] border border-[#B2DDFF]">
                <History className="h-4 w-4 text-[#2E90FA]" />
              </div>
            </div>
          </div>
          <div className="my-2 grid grid-cols-2 gap-4">
            <div className="glass-inset p-3 rounded-xl">
              <span className="text-[11px] text-[#667085] block font-medium">Total reviewed</span>
              <p className="font-display text-3xl font-semibold text-[#101828] tracking-tight mt-0.5 tnum">
                {totalReviewed}
              </p>
            </div>
            <div className="glass-inset p-3 rounded-xl">
              <span className="text-[11px] text-[#667085] block font-medium">Override rate</span>
              <p className="font-display text-3xl font-semibold text-[#B54708] tracking-tight mt-0.5 tnum">
                {overrideRate}%
              </p>
            </div>
          </div>
          <p className="text-xs text-[#667085] pt-3 border-t border-slate-200 leading-relaxed">
            {totalOverrides} overrides recorded in active session
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
          <div className="mt-3 pt-3 border-t border-slate-200 text-[11px] text-[#067647] font-semibold flex items-center justify-between">
            <span>FR-21 Feedback Store: Active</span>
            <span className="font-mono text-[10px] text-slate-500 font-normal">
              Append-Only Audit
            </span>
          </div>
        </div>
      </div>

      {/* 2. Review Queue Navigation & Triage List */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="flex items-center gap-3">
            <h3 className="font-headline text-lg text-[#101828] font-semibold tracking-tight flex items-center">
              <ClipboardList className="h-5 w-5 text-[#D92D20] mr-2" />
              Frontline Triage Queue
            </h3>
            {/* Filter Tabs */}
            <div className="inline-flex rounded-xl p-1 bg-slate-200/70 text-xs font-medium">
              <button
                onClick={() => setViewFilter('pending')}
                className={`px-3 py-1 rounded-lg transition-all ${
                  viewFilter === 'pending'
                    ? 'bg-white text-[#101828] shadow-xs font-semibold'
                    : 'text-[#667085] hover:text-[#101828]'
                }`}
              >
                Pending ({pendingInteractions.length})
              </button>
              <button
                onClick={() => setViewFilter('triaged')}
                className={`px-3 py-1 rounded-lg transition-all ${
                  viewFilter === 'triaged'
                    ? 'bg-white text-[#101828] shadow-xs font-semibold'
                    : 'text-[#667085] hover:text-[#101828]'
                }`}
              >
                Triaged ({triagedInteractions.length})
              </button>
              <button
                onClick={() => setViewFilter('all')}
                className={`px-3 py-1 rounded-lg transition-all ${
                  viewFilter === 'all'
                    ? 'bg-white text-[#101828] shadow-xs font-semibold'
                    : 'text-[#667085] hover:text-[#101828]'
                }`}
              >
                All Escalated ({escalatedInteractions.length})
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {reviewDecisions.length > 0 && onClearReviews && (
              <button
                onClick={handleResetSession}
                className="px-3 py-1.5 rounded-xl text-xs font-medium text-[#344054] bg-white border border-slate-200 hover:bg-slate-50 hover:text-rose-600 transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                title="Restore all items to pending triage queue"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset Queue Session</span>
              </button>
            )}
            <span className="text-xs text-[#98A2B3] hidden sm:inline font-medium">
              Target: &lt; 60s per item
            </span>
          </div>
        </div>

        {displayedInteractions.length === 0 ? (
          <div className="glass-panel rounded-2xl p-10 text-center space-y-4">
            <div className="h-14 w-14 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-sm">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <div className="space-y-1 max-w-md mx-auto">
              <p className="text-base font-semibold text-[#101828]">
                {viewFilter === 'triaged'
                  ? 'No Items Triaged Yet in this Session'
                  : 'Review Queue is Completely Clean'}
              </p>
              <p className="text-xs text-[#667085] leading-relaxed">
                {viewFilter === 'triaged'
                  ? 'Adjudicate pending interactions above to build your session audit trail.'
                  : totalReviewed > 0
                    ? `All ${totalReviewed} escalated interactions have been triaged in this session. You can reset the session anytime to re-evaluate items.`
                    : 'All escalated items have been triaged or no blocking violations are currently pending.'}
              </p>
            </div>

            {totalReviewed > 0 && onClearReviews && (
              <div className="pt-2 flex items-center justify-center gap-3">
                <button
                  onClick={handleResetSession}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] transition-all flex items-center gap-2 shadow-sm cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Reset Review Session (Restore Queue)</span>
                </button>
                <button
                  onClick={() => setViewFilter('triaged')}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-[#344054] bg-white border border-slate-200 hover:bg-slate-50 transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <History className="h-3.5 w-3.5 text-blue-600" />
                  <span>View Adjudications ({totalReviewed})</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          displayedInteractions.map((item) => {
            const evalRes = evaluations[item.id];
            if (!evalRes) return null;

            const existingDecision = reviewedMap.get(item.id);
            const isTriaged = Boolean(existingDecision);
            const isExpanded = expandedId === item.id;
            const isHighlighted = highlightedId === item.id;
            const isEditing = editingId === item.id;

            return (
              <div
                key={item.id}
                id={`queue-item-${item.id}`}
                className={`glass-panel rounded-2xl overflow-hidden transition-all duration-300 border-l-4 ${
                  isTriaged
                    ? 'border-l-emerald-500 opacity-90'
                    : evalRes.verdict === 'BLOCK_ESCALATE'
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
                      <span className="font-mono text-sm font-semibold text-[#101828] tnum">
                        {item.id}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-lg glass-inset text-[#344054] font-medium text-[11px]">
                        {item.use_case === 'decision_support'
                          ? 'Decision Support'
                          : item.use_case === 'internal_copilot'
                            ? 'Internal Copilot'
                            : 'Support Bot'}
                      </span>
                      <span className="font-mono text-[#98A2B3] text-xs tnum">
                        {item.session_id}
                      </span>
                      {isTriaged && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-[10px] font-semibold bg-emerald-50 border border-emerald-200 text-emerald-700 shadow-xs">
                          <Check className="h-3 w-3 mr-1 text-emerald-600" />
                          Triaged: {existingDecision?.action}
                        </span>
                      )}
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
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Expanded Inspection & Adjudication View */}
                {isExpanded && (
                  <div className="px-5 pb-5 pt-2 border-t border-slate-200/80 space-y-5 bg-white/40">
                    {/* Prompt & Retrieved Context */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      <div className="glass-inset p-4 rounded-xl space-y-1.5">
                        <span className="font-semibold text-[#101828] block">User Prompt</span>
                        <p className="text-[#344054] leading-relaxed font-sans">{item.prompt}</p>
                      </div>
                      <div className="glass-inset p-4 rounded-xl space-y-1.5">
                        <span className="font-semibold text-[#101828] block">
                          Retrieved Context Grounding
                        </span>
                        <p className="text-[#344054] leading-relaxed font-sans font-mono text-[11px] overflow-y-auto max-h-32">
                          {item.retrieved_context || (
                            <span className="text-[#98A2B3] italic">
                              No context retrieved (zero-shot)
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Model Response with Violation Highlighting */}
                    <div className="glass-inset p-4 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-[#101828] text-xs">
                          Candidate Output (with Lane Violation Highlights)
                        </span>
                        {evalRes.responsibility.redacted_response && (
                          <span className="text-[10px] font-mono text-[#4F46E5] bg-[#EEF0FE] border border-[#D9D6FE] px-2 py-0.5 rounded">
                            Automated Redaction Available
                          </span>
                        )}
                      </div>

                      {isEditing ? (
                        <div className="space-y-3 pt-2">
                          <textarea
                            value={editedText}
                            onChange={(e) => setEditedText(e.target.value)}
                            rows={4}
                            className="w-full glass-input rounded-xl p-3 font-mono text-xs text-[#101828] focus:ring-2 focus:ring-[#4F46E5] outline-none"
                            placeholder="Edit response before releasing..."
                          />
                          <div className="flex justify-end space-x-2">
                            <button
                              onClick={() => setEditingId(null)}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#475467] hover:bg-slate-100 transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleSaveEditAllow(item, evalRes)}
                              className="px-4 py-1.5 rounded-lg text-xs font-medium bg-[#4F46E5] text-white hover:bg-[#4338CA] transition-colors shadow-xs"
                            >
                              Approve Sanitized Version
                            </button>
                          </div>
                        </div>
                      ) : (
                        renderHighlightedResponse(item.response, evalRes)
                      )}
                    </div>

                    {/* Lane Risk Analysis Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                      {/* Performance */}
                      <div className="p-3 rounded-xl border border-slate-200/80 bg-white/60 space-y-1">
                        <div className="flex items-center justify-between text-[#667085]">
                          <span>Performance Lane</span>
                          <span className="font-mono font-semibold tnum">
                            {(evalRes.performance.groundedness_score * 100).toFixed(0)}%
                          </span>
                        </div>
                        <p className="text-[11px] text-[#344054] truncate">
                          {evalRes.performance.is_confidently_wrong
                            ? '🚨 Confidently Wrong'
                            : evalRes.performance.groundedness_score < 0.5
                              ? '⚠️ Low Grounding'
                              : '✅ Verified Grounding'}
                        </p>
                      </div>

                      {/* Cost */}
                      <div className="p-3 rounded-xl border border-slate-200/80 bg-white/60 space-y-1">
                        <div className="flex items-center justify-between text-[#667085]">
                          <span>Cost & Reliability</span>
                          <span className="font-mono font-semibold tnum">{item.latency_ms}ms</span>
                        </div>
                        <p className="text-[11px] text-[#344054] truncate">
                          {evalRes.cost.is_runaway_loop
                            ? '🚨 Runaway Loop'
                            : evalRes.cost.is_token_outlier
                              ? '⚠️ Token Outlier'
                              : '✅ Within Budget'}
                        </p>
                      </div>

                      {/* Responsibility */}
                      <div className="p-3 rounded-xl border border-slate-200/80 bg-white/60 space-y-1">
                        <div className="flex items-center justify-between text-[#667085]">
                          <span>Responsibility</span>
                          <span className="font-mono font-semibold tnum">
                            {evalRes.responsibility.risk_score > 0.5 ? 'HIGH RISK' : 'CLEAN'}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#344054] truncate">
                          {evalRes.responsibility.pii_detected
                            ? '🚨 PII Leak Detected'
                            : evalRes.responsibility.bias_detected
                              ? '⚠️ Bias / Redlining'
                              : '✅ Policy Compliant'}
                        </p>
                      </div>
                    </div>

                    {/* Review Notes Input */}
                    <div className="space-y-1.5 pt-1">
                      <label className="text-[11px] font-semibold text-[#475467] block">
                        Reviewer Rationale & Audit Notes
                      </label>
                      <input
                        type="text"
                        placeholder="Optional reviewer notes / feedback rationale..."
                        value={reviewNotes[item.id] || (existingDecision?.notes ?? '')}
                        onChange={(e) =>
                          setReviewNotes((prev) => ({ ...prev, [item.id]: e.target.value }))
                        }
                        className="w-full glass-input rounded-xl px-4 py-2.5 text-xs text-[#101828] placeholder:text-[#98A2B3]"
                      />
                    </div>

                    {/* Reviewer Action Bar */}
                    {!isEditing && (
                      <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-200">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[#667085] font-medium">
                            {isTriaged ? 'Triage status:' : 'Triage decision for frontline review:'}
                          </span>
                          {isTriaged && (
                            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                              {existingDecision?.action} by {existingDecision?.reviewer}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          {isTriaged && onDeleteReview && (
                            <button
                              onClick={() => handleReopenItem(item.id)}
                              className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-medium text-[#475467] bg-white border border-slate-200 hover:bg-slate-50 transition-all cursor-pointer shadow-xs"
                              title="Delete this decision and reopen item to pending queue"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              <span>Reopen Item</span>
                            </button>
                          )}

                          <button
                            onClick={() => handleConfirmBlock(item, evalRes)}
                            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-[#B42318] hover:bg-[#912018] text-white transition-all cursor-pointer shadow-xs active:scale-[0.98]"
                          >
                            <ShieldAlert className="h-3.5 w-3.5" />
                            <span>{isTriaged ? 'Re-confirm Block' : 'Confirm Block'}</span>
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
                            <span>{isTriaged ? 'Re-override to Allow' : 'Override to Allow'}</span>
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

      {/* 3. Append-Only Decision Audit Trail Table */}
      <div className="glass-panel rounded-2xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-200 pb-3 gap-3">
          <div>
            <h3 className="font-headline text-lg text-[#101828] font-semibold tracking-tight flex items-center">
              <History className="h-5 w-5 text-[#2E90FA] mr-2.5" />
              Append-Only Review Decision Audit Trail (FR-20 / FR-25)
            </h3>
            <p className="text-xs text-[#667085] mt-0.5">
              Immutable compliance ledger of frontline human adjudications.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-[#667085] whitespace-nowrap font-medium">
              <span className="font-mono tnum text-[#475467] font-semibold">
                {reviewDecisions.length}
              </span>{' '}
              recorded decisions
            </span>

            {reviewDecisions.length > 0 && onClearReviews && (
              <button
                onClick={handleResetSession}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                title="Wipe review session and restore all interactions to pending triage"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Clear Audit Session</span>
              </button>
            )}
          </div>
        </div>

        {reviewDecisions.length === 0 ? (
          <p className="text-[13px] text-[#667085] py-8 text-center">
            No manual triage decisions recorded yet in this session. Triage items above to populate
            the audit log.
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
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {reviewDecisions.map((d) => (
                  <tr key={d.id} className="hover:bg-white/60 transition-colors">
                    <td className="py-3 px-4 font-mono tnum text-[#667085]">
                      {new Date(d.reviewed_at).toLocaleTimeString()}
                    </td>
                    <td className="py-3 px-4 font-mono tnum font-semibold text-[#101828]">
                      {d.interaction_id}
                    </td>
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
                        <span className="font-mono text-[11px] text-[#B42318] font-semibold">
                          {d.original_verdict}
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 text-[#98A2B3] shrink-0" />
                        <span className="font-mono text-[11px] text-[#067647] font-semibold">
                          {d.new_verdict}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-[#475467] max-w-xs truncate">{d.notes}</td>
                    <td className="py-3 px-4 text-right">
                      {onDeleteReview && (
                        <button
                          onClick={() => handleReopenItem(d.interaction_id)}
                          className="px-2 py-1 rounded-lg text-[11px] text-[#667085] hover:text-rose-600 hover:bg-rose-50 transition-colors inline-flex items-center gap-1 cursor-pointer"
                          title="Reopen interaction back to pending triage queue"
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>Reopen</span>
                        </button>
                      )}
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
