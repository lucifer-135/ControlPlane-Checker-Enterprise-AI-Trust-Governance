/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  HelpCircle,
  ShieldAlert,
  Cpu,
  Scale,
  Clock,
  Lock,
  GitCompare,
} from 'lucide-react';
import type { JudgeEvaluationData } from '../types.js';

export interface JudgeData extends JudgeEvaluationData {}

interface GeminiJudgeResultCardProps {
  judgeData: JudgeData;
  className?: string;
  compact?: boolean;
}

export const GeminiJudgeResultCard: React.FC<GeminiJudgeResultCardProps> = ({
  judgeData,
  className = '',
  compact = false,
}) => {
  const [dualViewMode, setDualViewMode] = useState<'consensus' | 'sideBySide' | 'gemini' | 'local'>(
    'consensus',
  );

  const verdictUpper = (judgeData.verdict || '').toUpperCase();
  const isLocalQwen =
    judgeData.provider === 'qwen' ||
    (judgeData.modelUsed && judgeData.modelUsed.toLowerCase().includes('qwen'));
  const isDual = judgeData.provider === 'dual' || Boolean(judgeData.dualResults);

  // Determine styling based on evaluation verdict — frosted glass tints
  let theme = {
    container: 'bg-[#F4F3FF]/75 border-[#D9D6FE]/80',
    badge: 'bg-white text-[#6941C6] border-[#D9D6FE]',
    title: 'text-[#6941C6]',
    iconColor: 'text-[#7A5AF8]',
    Icon: HelpCircle,
    label: 'Ungrounded assertion',
    statGroundedness: 'text-[#6941C6]',
    statCertainty: 'text-[#475467]',
    statMismatch: 'text-[#6941C6]',
    borderDivider: 'border-slate-200',
  };

  if (
    verdictUpper.includes('SUPPORTED') &&
    !verdictUpper.includes('UNSUPPORTED') &&
    !verdictUpper.includes('PARTIAL')
  ) {
    theme = {
      container: 'bg-[#F6FEF9]/90 border-[#ABEFC6]',
      badge: 'bg-white text-[#067647] border-[#ABEFC6]',
      title: 'text-[#067647]',
      iconColor: 'text-[#12B76A]',
      Icon: CheckCircle2,
      label: 'Verified grounded & safe',
      statGroundedness: 'text-[#067647]',
      statCertainty: 'text-[#067647]',
      statMismatch: 'text-[#067647]',
      borderDivider: 'border-slate-200',
    };
  } else if (verdictUpper.includes('AMBIGUOUS') || verdictUpper.includes('PARTIAL')) {
    theme = {
      container: 'bg-[#FFFCF5]/90 border-[#FEDF89]',
      badge: 'bg-white text-[#B54708] border-[#FEDF89]',
      title: 'text-[#B54708]',
      iconColor: 'text-[#F79009]',
      Icon: AlertTriangle,
      label: 'Ambiguous grounding',
      statGroundedness: 'text-[#B54708]',
      statCertainty: 'text-[#B54708]',
      statMismatch: 'text-[#B54708]',
      borderDivider: 'border-slate-200',
    };
  } else if (verdictUpper.includes('CONFIDENTLY_WRONG')) {
    theme = {
      container: 'bg-[#FFFBFA]/90 border-[#FECDCA]',
      badge: 'bg-white text-[#B42318] border-[#FECDCA]',
      title: 'text-[#B42318]',
      iconColor: 'text-[#F04438]',
      Icon: AlertOctagon,
      label: 'Severe hallucination / overconfidence',
      statGroundedness: 'text-[#B42318]',
      statCertainty: 'text-[#B42318]',
      statMismatch: 'text-[#B42318]',
      borderDivider: 'border-slate-200',
    };
  } else if (
    verdictUpper.includes('UNSUPPORTED') ||
    verdictUpper.includes('UNGROUNDED') ||
    verdictUpper.includes('BLOCK')
  ) {
    theme = {
      container: 'bg-[#F4F3FF]/90 border-[#D9D6FE]',
      badge: 'bg-white text-[#6941C6] border-[#D9D6FE]',
      title: 'text-[#6941C6]',
      iconColor: 'text-[#7A5AF8]',
      Icon: ShieldAlert,
      label: 'Ungrounded context violation',
      statGroundedness: 'text-[#6941C6]',
      statCertainty: 'text-[#475467]',
      statMismatch: 'text-[#6941C6]',
      borderDivider: 'border-slate-200',
    };
  }

  const groundednessPct =
    typeof judgeData.groundednessScore === 'number'
      ? Math.round(judgeData.groundednessScore * 100)
      : null;
  const certaintyPct =
    typeof judgeData.certaintyScore === 'number'
      ? Math.round(judgeData.certaintyScore * 100)
      : null;
  const mismatchPct =
    typeof judgeData.certaintySupportMismatch === 'number'
      ? Math.round(judgeData.certaintySupportMismatch * 100)
      : null;

  // Render Dual Consensus Mode
  if (isDual && judgeData.dualResults) {
    const { gemini, local } = judgeData.dualResults;
    const isAgreed = judgeData.consensus === 'AGREED';

    return (
      <div
        className={`rounded-2xl border p-5 space-y-4 transition-all backdrop-blur-xl backdrop-saturate-180 shadow-[0_8px_30px_rgba(0,0,0,0.04),inset_0_1px_0_0_rgba(255,255,255,0.95)] ${theme.container} ${className}`}
      >
        {/* Dual Consensus Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200/70">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-xl bg-white shadow-xs border border-slate-200/80 text-[#4F46E5]">
              <Scale className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold font-headline tracking-tight text-[#101828]">
                  Dual Judge Consensus
                </span>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    isAgreed
                      ? 'bg-[#ECFDF3] text-[#027A48] border-[#ABEFC6]'
                      : 'bg-[#FFFAEB] text-[#B54708] border-[#FEDF89]'
                  }`}
                >
                  {isAgreed ? '100% Concordance' : 'Discrepancy Detected'}
                </span>
              </div>
              <p className="text-[11px] text-[#667085] mt-0.5">
                Google Gemini Cloud &amp; Qwen 2.5: 7B Local Sovereign evaluated simultaneously
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {judgeData.latencyMs && (
              <span className="inline-flex items-center space-x-1 text-[11px] font-mono text-[#667085] bg-white/80 px-2 py-1 rounded-lg border border-slate-200">
                <Clock className="h-3 w-3 text-[#98A2B3]" />
                <span>{judgeData.latencyMs}ms</span>
              </span>
            )}
            <span
              className={`font-mono text-xs px-2.5 py-1 rounded-lg border font-semibold flex items-center space-x-1.5 backdrop-blur-md shadow-xs ${theme.badge}`}
            >
              <theme.Icon className="h-3.5 w-3.5" />
              <span>{judgeData.verdict}</span>
            </span>
          </div>
        </div>

        {/* View Switcher Pills */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-200/50 border border-slate-200/70 w-fit text-[11px] font-medium text-[#475467]">
          <button
            type="button"
            onClick={() => setDualViewMode('consensus')}
            className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
              dualViewMode === 'consensus'
                ? 'bg-white text-[#4338CA] font-semibold shadow-xs'
                : 'hover:text-[#101828]'
            }`}
          >
            Consensus Summary
          </button>
          <button
            type="button"
            onClick={() => setDualViewMode('sideBySide')}
            className={`px-3 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
              dualViewMode === 'sideBySide'
                ? 'bg-white text-[#4338CA] font-semibold shadow-xs'
                : 'hover:text-[#101828]'
            }`}
          >
            <GitCompare className="h-3 w-3" />
            <span>Side-by-Side</span>
          </button>
          <button
            type="button"
            onClick={() => setDualViewMode('gemini')}
            className={`px-3 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
              dualViewMode === 'gemini'
                ? 'bg-white text-[#4338CA] font-semibold shadow-xs'
                : 'hover:text-[#101828]'
            }`}
          >
            <Sparkles className="h-3 w-3 text-[#4F46E5]" />
            <span>Gemini ({gemini?.modelUsed || 'Cloud'})</span>
          </button>
          <button
            type="button"
            onClick={() => setDualViewMode('local')}
            className={`px-3 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
              dualViewMode === 'local'
                ? 'bg-white text-[#0E7090] font-semibold shadow-xs'
                : 'hover:text-[#101828]'
            }`}
          >
            <Cpu className="h-3 w-3 text-[#0891B2]" />
            <span>Qwen 2.5: 7B (Local)</span>
          </button>
        </div>

        {/* View Mode: Consensus Summary */}
        {dualViewMode === 'consensus' && (
          <div className="space-y-3">
            <div className="glass-inset p-3.5 rounded-xl border border-white/60 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#101828]">Consensus Note:</span>
                <span className="text-[11px] font-mono text-[#667085]">
                  Delta: Groundedness{' '}
                  {Math.round((judgeData.scoreDeltas?.groundednessDelta ?? 0) * 100)}% | Certainty{' '}
                  {Math.round((judgeData.scoreDeltas?.certaintyDelta ?? 0) * 100)}%
                </span>
              </div>
              <p className="text-[13px] text-[#344054] leading-relaxed font-sans">
                {judgeData.consensusNote || judgeData.reasoning}
              </p>
            </div>

            {/* Quick side-by-side comparison cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              <div className="bg-white/80 border border-slate-200 rounded-xl p-3.5 space-y-2 shadow-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 text-xs font-semibold text-[#4338CA]">
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Gemini ({gemini?.modelUsed || 'Cloud'})</span>
                  </div>
                  <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-[#344054]">
                    {gemini?.verdict}
                  </span>
                </div>
                <p className="text-xs text-[#475467] line-clamp-3 leading-relaxed">
                  {gemini?.reasoning}
                </p>
                <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-100 font-mono text-[#667085]">
                  <span>
                    Groundedness:{' '}
                    {typeof gemini?.groundednessScore === 'number'
                      ? `${Math.round(gemini.groundednessScore * 100)}%`
                      : 'N/A'}
                  </span>
                  <span>Latency: {gemini?.latencyMs}ms</span>
                </div>
              </div>

              <div className="bg-white/80 border border-cyan-200/80 rounded-xl p-3.5 space-y-2 shadow-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 text-xs font-semibold text-[#0E7090]">
                    <Cpu className="h-3.5 w-3.5" />
                    <span>Qwen 2.5: 7B (Local Sovereign)</span>
                  </div>
                  <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-md bg-cyan-50 text-[#0E7090] border border-cyan-200/50">
                    {local?.verdict}
                  </span>
                </div>
                <p className="text-xs text-[#475467] line-clamp-3 leading-relaxed">
                  {local?.reasoning}
                </p>
                <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-100 font-mono text-[#667085]">
                  <span>
                    Groundedness:{' '}
                    {typeof local?.groundednessScore === 'number'
                      ? `${Math.round(local.groundednessScore * 100)}%`
                      : 'N/A'}
                  </span>
                  <span>Latency: {local?.latencyMs}ms</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* View Mode: Side-by-Side In-Depth */}
        {dualViewMode === 'sideBySide' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Gemini Column */}
            <div className="bg-white/90 border border-[#D9D6FE] rounded-xl p-4 space-y-3 shadow-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <div className="flex items-center space-x-1.5 text-xs font-bold text-[#6941C6]">
                  <Sparkles className="h-4 w-4" />
                  <span>Google Gemini ({gemini?.modelUsed})</span>
                </div>
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-[#F4F3FF] text-[#6941C6] border border-[#D9D6FE]">
                  {gemini?.verdict}
                </span>
              </div>
              <p className="text-xs text-[#344054] leading-relaxed font-sans">
                {gemini?.reasoning}
              </p>
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-center font-mono">
                <div className="p-1.5 rounded-lg bg-slate-50">
                  <div className="text-[10px] text-[#667085]">Grounded</div>
                  <div className="text-xs font-bold text-[#6941C6]">
                    {Math.round((gemini?.groundednessScore ?? 0) * 100)}%
                  </div>
                </div>
                <div className="p-1.5 rounded-lg bg-slate-50">
                  <div className="text-[10px] text-[#667085]">Certainty</div>
                  <div className="text-xs font-bold text-[#344054]">
                    {Math.round((gemini?.certaintyScore ?? 0) * 100)}%
                  </div>
                </div>
                <div className="p-1.5 rounded-lg bg-slate-50">
                  <div className="text-[10px] text-[#667085]">Mismatch</div>
                  <div className="text-xs font-bold text-[#B42318]">
                    {Math.round((gemini?.certaintySupportMismatch ?? 0) * 100)}%
                  </div>
                </div>
              </div>
            </div>

            {/* Local Qwen Column */}
            <div className="bg-white/90 border border-cyan-200 rounded-xl p-4 space-y-3 shadow-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <div className="flex items-center space-x-1.5 text-xs font-bold text-[#0E7090]">
                  <Cpu className="h-4 w-4" />
                  <span>Qwen 2.5: 7B (Local Sovereign)</span>
                </div>
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-cyan-50 text-[#0E7090] border border-cyan-200">
                  {local?.verdict}
                </span>
              </div>
              <p className="text-xs text-[#344054] leading-relaxed font-sans">{local?.reasoning}</p>
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-center font-mono">
                <div className="p-1.5 rounded-lg bg-slate-50">
                  <div className="text-[10px] text-[#667085]">Grounded</div>
                  <div className="text-xs font-bold text-[#0E7090]">
                    {Math.round((local?.groundednessScore ?? 0) * 100)}%
                  </div>
                </div>
                <div className="p-1.5 rounded-lg bg-slate-50">
                  <div className="text-[10px] text-[#667085]">Certainty</div>
                  <div className="text-xs font-bold text-[#344054]">
                    {Math.round((local?.certaintyScore ?? 0) * 100)}%
                  </div>
                </div>
                <div className="p-1.5 rounded-lg bg-slate-50">
                  <div className="text-[10px] text-[#667085]">Mismatch</div>
                  <div className="text-xs font-bold text-[#B42318]">
                    {Math.round((local?.certaintySupportMismatch ?? 0) * 100)}%
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* View Mode: Gemini Only Tab */}
        {dualViewMode === 'gemini' && gemini && (
          <div className="glass-inset p-4 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#4338CA]">
                Google Gemini Evaluation Details
              </span>
              <span className="font-mono text-xs font-semibold text-[#344054]">
                {gemini.verdict}
              </span>
            </div>
            <p className="text-xs text-[#344054] leading-relaxed">{gemini.reasoning}</p>
          </div>
        )}

        {/* View Mode: Local Qwen Only Tab */}
        {dualViewMode === 'local' && local && (
          <div className="glass-inset p-4 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#0E7090]">
                Qwen 2.5: 7B Local Evaluation Details
              </span>
              <span className="font-mono text-xs font-semibold text-[#344054]">
                {local.verdict}
              </span>
            </div>
            <p className="text-xs text-[#344054] leading-relaxed">{local.reasoning}</p>
          </div>
        )}

        {/* Combined Triggering Spans */}
        {judgeData.triggeringSpans && judgeData.triggeringSpans.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <span className="text-[11px] font-medium text-[#667085]">
              Triggering claims / spans identified
            </span>
            <div className="flex flex-wrap gap-1.5">
              {judgeData.triggeringSpans.map((span, idx) => (
                <span
                  key={idx}
                  className="font-mono text-[11px] bg-[#FEF3F2]/90 text-[#B42318] border border-[#FECDCA] px-2 py-0.5 rounded-lg shadow-xs"
                >
                  "{span}"
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Metric Breakdown Stats Footer */}
        <div className={`grid grid-cols-3 gap-3 pt-3 border-t ${theme.borderDivider}`}>
          <div className="glass-inset p-2.5 rounded-xl text-center">
            <div className="text-[10px] text-[#667085] font-medium mb-0.5">
              Average Groundedness
            </div>
            <div className={`font-mono font-semibold tnum ${theme.statGroundedness}`}>
              {groundednessPct !== null ? `${groundednessPct}%` : 'N/A'}
            </div>
          </div>
          <div className="glass-inset p-2.5 rounded-xl text-center">
            <div className="text-[10px] text-[#667085] font-medium mb-0.5">Average Certainty</div>
            <div className={`font-mono font-semibold tnum ${theme.statCertainty}`}>
              {certaintyPct !== null ? `${certaintyPct}%` : 'N/A'}
            </div>
          </div>
          <div className="glass-inset p-2.5 rounded-xl text-center">
            <div className="text-[10px] text-[#667085] font-medium mb-0.5">Support Mismatch</div>
            <div className={`font-mono font-semibold tnum ${theme.statMismatch}`}>
              {mismatchPct !== null ? `${mismatchPct}%` : 'N/A'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Single Judge Evaluation Mode (Gemini or Qwen 2.5: 7B)
  return (
    <div
      className={`rounded-xl border p-5 space-y-4 transition-all backdrop-blur-xl backdrop-saturate-180 shadow-[0_8px_30px_rgba(0,0,0,0.04),inset_0_1px_0_0_rgba(255,255,255,0.95)] ${theme.container} ${className}`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center space-x-2.5">
          <div className="p-1 rounded-lg bg-white/90 shadow-xs border border-slate-200">
            {isLocalQwen ? (
              <Cpu className="h-4 w-4 text-[#0891B2]" />
            ) : (
              <Sparkles className={`h-4 w-4 ${theme.iconColor}`} />
            )}
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className={`text-xs font-semibold font-headline tracking-tight ${theme.title}`}>
                {isLocalQwen
                  ? `Local LLM Judge (${judgeData.modelUsed || 'qwen2.5:7b'})`
                  : judgeData.modelUsed && judgeData.modelUsed !== 'autonomous-evaluator-fallback'
                    ? `Gemini Judge (${judgeData.modelUsed})`
                    : 'AI Governance LLM Judge'}
              </span>
              {isLocalQwen && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-cyan-50 text-[#0E7090] border border-cyan-200">
                  <Lock className="h-2.5 w-2.5" />
                  <span>Zero Data Egress</span>
                </span>
              )}
            </div>
            {judgeData.latencyMs && (
              <span className="text-[10px] font-mono text-[#667085] flex items-center gap-1 mt-0.5">
                <Clock className="h-2.5 w-2.5" />
                <span>Execution latency: {judgeData.latencyMs}ms</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-[11px] text-[#667085] hidden sm:inline">{theme.label}</span>
          <span
            className={`font-mono text-xs px-2.5 py-1 rounded-lg border font-semibold flex items-center space-x-1.5 backdrop-blur-md shadow-xs ${theme.badge}`}
          >
            <theme.Icon className="h-3.5 w-3.5" />
            <span>{judgeData.verdict}</span>
          </span>
        </div>
      </div>

      {/* Reasoning Body */}
      <p className="text-[13px] text-[#344054] leading-relaxed font-sans glass-inset p-4 rounded-xl">
        {judgeData.reasoning}
      </p>

      {/* Triggering Spans if any */}
      {judgeData.triggeringSpans && judgeData.triggeringSpans.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-[11px] font-medium text-[#667085]">Triggering claims / spans</span>
          <div className="flex flex-wrap gap-1.5">
            {judgeData.triggeringSpans.map((span, idx) => (
              <span
                key={idx}
                className="font-mono text-[11px] bg-[#FEF3F2]/90 text-[#B42318] border border-[#FECDCA] px-2 py-0.5 rounded-lg shadow-xs"
              >
                "{span}"
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Metric Breakdown Stats Footer */}
      {(groundednessPct !== null || certaintyPct !== null || mismatchPct !== null) && (
        <div className={`grid grid-cols-3 gap-3 pt-3 border-t ${theme.borderDivider}`}>
          <div className="glass-inset p-2.5 rounded-xl text-center">
            <div className="text-[10px] text-[#667085] font-medium mb-0.5">Groundedness</div>
            <div className={`font-mono font-semibold tnum ${theme.statGroundedness}`}>
              {groundednessPct !== null ? `${groundednessPct}%` : 'N/A'}
            </div>
          </div>
          <div className="glass-inset p-2.5 rounded-xl text-center">
            <div className="text-[10px] text-[#667085] font-medium mb-0.5">Certainty</div>
            <div className={`font-mono font-semibold tnum ${theme.statCertainty}`}>
              {certaintyPct !== null ? `${certaintyPct}%` : 'N/A'}
            </div>
          </div>
          <div className="glass-inset p-2.5 rounded-xl text-center">
            <div className="text-[10px] text-[#667085] font-medium mb-0.5">Mismatch</div>
            <div className={`font-mono font-semibold tnum ${theme.statMismatch}`}>
              {mismatchPct !== null ? `${mismatchPct}%` : 'N/A'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Backwards-compatible and semantic alias
export const JudgeResultCard = GeminiJudgeResultCard;
