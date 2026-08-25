/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Sparkles, CheckCircle2, AlertTriangle, AlertOctagon, HelpCircle, ShieldAlert } from 'lucide-react';

export interface JudgeData {
  verdict: string;
  reasoning: string;
  groundednessScore?: number;
  certaintyScore?: number;
  certaintySupportMismatch?: number;
  triggeringSpans?: string[];
  isLiveLLM?: boolean;
}

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
  const verdictUpper = (judgeData.verdict || '').toUpperCase();

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

  if (verdictUpper.includes('SUPPORTED') && !verdictUpper.includes('UNSUPPORTED') && !verdictUpper.includes('PARTIAL')) {
    // Verified / Grounded
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
    // Ambiguous / Partial Overlap
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
    // Confidently Wrong / Hallucination Alert
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
  } else if (verdictUpper.includes('UNSUPPORTED') || verdictUpper.includes('UNGROUNDED') || verdictUpper.includes('BLOCK')) {
    // Policy Violations / Ungrounded
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

  const groundednessPct = typeof judgeData.groundednessScore === 'number' ? Math.round(judgeData.groundednessScore * 100) : null;
  const certaintyPct = typeof judgeData.certaintyScore === 'number' ? Math.round(judgeData.certaintyScore * 100) : null;
  const mismatchPct = typeof judgeData.certaintySupportMismatch === 'number' ? Math.round(judgeData.certaintySupportMismatch * 100) : null;

  return (
    <div className={`rounded-xl border p-5 space-y-4 transition-all backdrop-blur-xl backdrop-saturate-180 shadow-[0_8px_30px_rgba(0,0,0,0.04),inset_0_1px_0_0_rgba(255,255,255,0.95)] ${theme.container} ${className}`}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center space-x-2">
          <div className="p-1 rounded-lg bg-white/90 shadow-xs border border-slate-200">
            <Sparkles className={`h-4 w-4 ${theme.iconColor}`} />
          </div>
          <span className={`text-xs font-semibold font-headline tracking-tight ${theme.title}`}>
            Gemini 3.6 Flash LLM Judge
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-[11px] text-[#667085] hidden sm:inline">
            {theme.label}
          </span>
          <span className={`font-mono text-xs px-2.5 py-1 rounded-lg border font-semibold flex items-center space-x-1.5 backdrop-blur-md shadow-xs ${theme.badge}`}>
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
          <span className="text-[11px] font-medium text-[#667085]">
            Triggering claims / spans
          </span>
          <div className="flex flex-wrap gap-1.5">
            {judgeData.triggeringSpans.map((span, idx) => (
              <span key={idx} className="font-mono text-[11px] bg-[#FEF3F2]/90 text-[#B42318] border border-[#FECDCA] px-2 py-0.5 rounded-lg shadow-xs">
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
            <div className={`font-mono font-semibold tnum ${theme.statGroundedness}`}>{groundednessPct !== null ? `${groundednessPct}%` : 'N/A'}</div>
          </div>
          <div className="glass-inset p-2.5 rounded-xl text-center">
            <div className="text-[10px] text-[#667085] font-medium mb-0.5">Certainty</div>
            <div className={`font-mono font-semibold tnum ${theme.statCertainty}`}>{certaintyPct !== null ? `${certaintyPct}%` : 'N/A'}</div>
          </div>
          <div className="glass-inset p-2.5 rounded-xl text-center">
            <div className="text-[10px] text-[#667085] font-medium mb-0.5">Mismatch</div>
            <div className={`font-mono font-semibold tnum ${theme.statMismatch}`}>{mismatchPct !== null ? `${mismatchPct}%` : 'N/A'}</div>
          </div>
        </div>
      )}
    </div>
  );
};
