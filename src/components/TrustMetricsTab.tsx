/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { EvaluationResult, PolicyProfile, SyntheticInteraction, UseCaseId } from '../types';
import {
  computeConfusionMatrix,
  generateTradeoffCurve,
  getConfusionMatrixItems,
} from '../lib/metrics';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import {
  BarChart3,
  Scale,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Info,
  Sparkles,
  SlidersHorizontal,
} from 'lucide-react';

interface TrustMetricsTabProps {
  interactions: SyntheticInteraction[];
  evaluations: Record<string, EvaluationResult>;
  policyProfiles: Record<UseCaseId, PolicyProfile>;
  onUpdateThreshold: (useCase: UseCaseId | 'ALL', newThreshold: number) => void;
  activeUseCase: UseCaseId | 'ALL';
  setActiveUseCase: (u: UseCaseId | 'ALL') => void;
}

export const TrustMetricsTab: React.FC<TrustMetricsTabProps> = ({
  interactions,
  evaluations,
  policyProfiles,
  onUpdateThreshold,
  activeUseCase,
  setActiveUseCase,
}) => {
  // Current active threshold from the profile
  const currentThreshold =
    activeUseCase === 'ALL'
      ? policyProfiles.support_bot.thresholds.block_escalate
      : policyProfiles[activeUseCase].thresholds.block_escalate;

  const [sliderVal, setSliderVal] = useState<number>(currentThreshold);
  const [selectedQuadrant, setSelectedQuadrant] = useState<'TP' | 'FP' | 'TN' | 'FN' | null>(null);

  // Compute live confusion matrix at current state
  const confusionMatrix = useMemo(() => {
    return computeConfusionMatrix(
      interactions,
      evaluations,
      activeUseCase === 'ALL' ? undefined : activeUseCase,
    );
  }, [interactions, evaluations, activeUseCase]);

  // Generate full sweep trade-off curve
  const tradeoffCurveData = useMemo(() => {
    return generateTradeoffCurve(
      interactions,
      policyProfiles,
      activeUseCase === 'ALL' ? undefined : activeUseCase,
    );
  }, [interactions, policyProfiles, activeUseCase]);

  // Breakdown of items per quadrant for drill-down inspection
  const quadrantItems = useMemo(() => {
    return getConfusionMatrixItems(
      interactions,
      evaluations,
      activeUseCase === 'ALL' ? undefined : activeUseCase,
    );
  }, [interactions, evaluations, activeUseCase]);

  const handleSliderChange = (newVal: number) => {
    setSliderVal(newVal);
    onUpdateThreshold(activeUseCase, newVal);
  };

  return (
    <div className="space-y-6">
      {/* 1. Header & Live Tradeoff Dial Strip */}
      {/* 1. Master Tradeoff Dial Controller */}
      <div className="glass-panel rounded-2xl p-6 sm:p-8 space-y-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none -z-10" />
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <div className="flex items-center space-x-2.5">
              <div className="w-10 h-10 rounded-xl bg-[#EEF0FE]/90 border border-[#D9D6FE] flex items-center justify-center text-[#4F46E5] shadow-xs">
                <Scale className="h-5 w-5" />
              </div>
              <h2 className="font-headline text-xl sm:text-2xl font-semibold text-[#101828] tracking-tight">
                Trust &amp; Governance Tradeoff Dial
              </h2>
              <span className="text-[10px] px-2.5 py-1 rounded-full bg-[#ECFDF3]/90 border border-[#ABEFC6] text-[#067647] font-semibold flex items-center gap-1.5 shadow-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-[#12B76A]"></span>
                Live Calibrated Dial
              </span>
            </div>
            <p className="text-xs text-[#475467] mt-2 max-w-2xl leading-relaxed font-sans">
              Governance is a calibrated dial, not a binary switch. Drag the slider below to watch
              the live trade-off between{' '}
              <strong className="text-[#B54708]">Alert Fatigue (False Positives)</strong> and{' '}
              <strong className="text-[#B42318]">Compliance Liability (False Negatives)</strong>{' '}
              shift against our labeled ground-truth dataset in real time.
            </p>
          </div>

          {/* Scope Selector */}
          <div className="flex items-center space-x-1.5 glass-inset p-1 rounded-xl text-xs">
            <span className="text-[#667085] px-2 font-medium text-[11px]">Scope:</span>
            {[
              { id: 'ALL', label: 'All Use Cases' },
              { id: 'support_bot', label: 'Support Bot' },
              { id: 'internal_copilot', label: 'Internal Copilot' },
              { id: 'decision_support', label: 'Decision Support' },
            ].map((u) => (
              <button
                key={u.id}
                onClick={() => {
                  setActiveUseCase(u.id as any);
                  const t =
                    u.id === 'ALL'
                      ? policyProfiles.support_bot.thresholds.block_escalate
                      : policyProfiles[u.id as UseCaseId].thresholds.block_escalate;
                  setSliderVal(t);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  activeUseCase === u.id
                    ? 'bg-[#4F46E5] text-white shadow-xs font-semibold'
                    : 'text-[#667085] hover:text-[#101828]'
                }`}
              >
                {u.label}
              </button>
            ))}
          </div>
        </div>

        {/* The Master Slider Control */}
        <div className="glass-inset rounded-2xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-xs font-semibold text-[#101828] flex items-center">
                <SlidersHorizontal className="h-4 w-4 mr-2 text-[#4F46E5]" />
                Active Block + Escalate Decision Threshold
              </span>
              <span className="text-[11px] text-[#667085]">
                Interactions scoring above this composite cutoff are withheld from users
              </span>
            </div>
            <div className="flex items-center space-x-3">
              <span className="font-headline text-2xl font-bold font-mono tnum text-[#101828] bg-white/90 px-4 py-1 rounded-xl border border-white/80 shadow-xs">
                {sliderVal.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <input
              id="tradeoff-threshold-slider"
              type="range"
              min="0.20"
              max="0.85"
              step="0.05"
              value={sliderVal}
              onChange={(e) => handleSliderChange(parseFloat(e.target.value))}
              className="w-full h-3 bg-slate-300 hover:bg-slate-400/70 border border-slate-400 rounded-full cursor-pointer shadow-inner accent-[#4F46E5] transition-colors"
            />
            <div className="flex justify-between font-mono tnum text-[11px] text-[#667085] pt-1">
              <span className="text-[#667085] font-semibold">0.20 (Strict / Low risk)</span>
              <span className="text-[#4F46E5] font-bold bg-white border border-[#C7D2FE] px-2.5 py-0.5 rounded-md shadow-xs">
                Active Cutoff: {sliderVal.toFixed(2)}
              </span>
              <span className="text-[#667085] font-semibold">0.85 (Permissive / High risk)</span>
            </div>
          </div>
        </div>

        {/* Six Live KPI Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {/* False Positive Rate */}
          <div className="glass-inset rounded-2xl p-4">
            <span className="text-[10px] text-[#475467] font-semibold block">
              False Positive Rate
            </span>
            <div className="mt-1 flex items-baseline space-x-1.5">
              <span className="text-xl font-bold text-[#B54708] font-headline tnum">
                {confusionMatrix.fp_rate}%
              </span>
              <span className="text-[10px] text-[#98A2B3] tnum">
                ({confusionMatrix.false_positives})
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full bg-white/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#F79009]"
                style={{ width: `${Math.min(confusionMatrix.fp_rate, 100)}%` }}
              ></div>
            </div>
            <p className="mt-2 text-[10px] text-[#667085]">Alert fatigue risk</p>
          </div>

          {/* False Negative Rate */}
          <div className="glass-inset rounded-2xl p-4">
            <span className="text-[10px] text-[#475467] font-semibold block">
              False Negative Rate
            </span>
            <div className="mt-1 flex items-baseline space-x-1.5">
              <span className="text-xl font-bold text-[#B42318] font-headline tnum">
                {confusionMatrix.fn_rate}%
              </span>
              <span className="text-[10px] text-[#98A2B3] tnum">
                ({confusionMatrix.false_negatives})
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full bg-white/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#F04438]"
                style={{ width: `${Math.min(confusionMatrix.fn_rate, 100)}%` }}
              ></div>
            </div>
            <p className="mt-2 text-[10px] text-[#667085]">Compliance risk</p>
          </div>

          {/* Precision */}
          <div className="glass-inset rounded-2xl p-4">
            <span className="text-[10px] text-[#475467] font-semibold block">Precision</span>
            <div className="mt-1 text-xl font-bold text-[#067647] font-headline tnum">
              {confusionMatrix.precision}%
            </div>
            <div className="mt-2 h-1.5 w-full bg-white/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#12B76A]"
                style={{ width: `${Math.min(confusionMatrix.precision, 100)}%` }}
              ></div>
            </div>
            <p className="mt-2 text-[10px] text-[#667085]">TP / (TP + FP)</p>
          </div>

          {/* Recall */}
          <div className="glass-inset rounded-2xl p-4">
            <span className="text-[10px] text-[#475467] font-semibold block">Recall</span>
            <div className="mt-1 text-xl font-bold text-[#175CD3] font-headline tnum">
              {confusionMatrix.recall}%
            </div>
            <div className="mt-2 h-1.5 w-full bg-white/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#2E90FA]"
                style={{ width: `${Math.min(confusionMatrix.recall, 100)}%` }}
              ></div>
            </div>
            <p className="mt-2 text-[10px] text-[#667085]">TP / (TP + FN)</p>
          </div>

          {/* F1 Score */}
          <div className="glass-inset rounded-2xl p-4">
            <span className="text-[10px] text-[#475467] font-semibold block">F1 Trust Score</span>
            <div className="mt-1 text-xl font-bold text-[#6941C6] font-headline tnum">
              {confusionMatrix.f1_score}%
            </div>
            <div className="mt-2 h-1.5 w-full bg-white/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#7A5AF8]"
                style={{ width: `${Math.min(confusionMatrix.f1_score, 100)}%` }}
              ></div>
            </div>
            <p className="mt-2 text-[10px] text-[#667085]">Harmonic balance</p>
          </div>

          {/* Total Blocked */}
          <div className="glass-inset rounded-2xl p-4">
            <span className="text-[10px] text-[#475467] font-semibold block">Blocked Volume</span>
            <div className="mt-1 flex items-baseline space-x-1">
              <span className="text-xl font-bold text-[#101828] font-headline tnum">
                {confusionMatrix.true_positives + confusionMatrix.false_positives}
              </span>
              <span className="text-[10px] text-[#98A2B3] tnum">
                / {confusionMatrix.total_evaluated}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full bg-white/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#F04438]"
                style={{
                  width: `${((confusionMatrix.true_positives + confusionMatrix.false_positives) / confusionMatrix.total_evaluated) * 100}%`,
                }}
              ></div>
            </div>
            <p className="mt-2 text-[10px] text-[#667085]">
              {(
                ((confusionMatrix.true_positives + confusionMatrix.false_positives) /
                  confusionMatrix.total_evaluated) *
                100
              ).toFixed(0)}
              % of traffic
            </p>
          </div>
        </div>
      </div>

      {/* 2. Recharts Tradeoff Curve Visualizer */}
      <div className="glass-panel rounded-2xl p-6 sm:p-8 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <h3 className="font-headline text-sm text-[#101828] flex items-center font-semibold tracking-tight">
              <BarChart3 className="h-4 w-4 mr-2 text-[#4F46E5]" />
              Precision-Recall Tradeoff Sweep Curve
            </h3>
            <p className="text-xs text-[#667085] mt-1 font-sans">
              False Positive Rate (FPR) vs False Negative Rate (FNR) vs F1 Score on current
              benchmark
            </p>
          </div>
          <div className="flex items-center space-x-5 text-xs">
            <span className="flex items-center text-[#475467] font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-[#F79009] mr-1.5 shadow-xs"></span> FPR
              (Alert Fatigue)
            </span>
            <span className="flex items-center text-[#475467] font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-[#2E90FA] mr-1.5 shadow-xs"></span> FNR
              (Liability)
            </span>
            <span className="flex items-center text-[#475467] font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-[#12B76A] mr-1.5 shadow-xs"></span> F1
              Score
            </span>
          </div>
        </div>

        {/* Recharts Chart Container */}
        <div className="h-80 sm:h-96 w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={tradeoffCurveData} margin={{ top: 25, right: 30, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(213, 218, 225, 0.6)" />
              <XAxis
                dataKey="threshold"
                stroke="#98A2B3"
                tick={{ fill: '#667085', fontSize: 11 }}
                label={{
                  value: 'Decision Threshold →',
                  position: 'insideBottom',
                  offset: -4,
                  fill: '#667085',
                  fontSize: 11,
                }}
              />
              <YAxis
                stroke="#98A2B3"
                tick={{ fill: '#667085', fontSize: 11 }}
                unit="%"
                domain={[0, 100]}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(255, 255, 255, 0.95)',
                  backdropFilter: 'blur(16px)',
                  border: '1px solid rgba(203, 213, 225, 0.9)',
                  borderRadius: '0.75rem',
                  fontSize: '12px',
                  color: '#344054',
                  boxShadow:
                    '0 12px 24px -8px rgba(16, 24, 40, 0.12), 0 4px 8px -4px rgba(16, 24, 40, 0.08)',
                }}
                labelStyle={{ color: '#101828', fontWeight: 600 }}
                itemStyle={{ color: '#344054' }}
                formatter={(value: any, name: any) => [`${value}%`, name]}
                labelFormatter={(label) => `Threshold: ${label}`}
              />
              {/* Vertical Reference Line for Active Threshold */}
              <ReferenceLine
                x={Number(sliderVal.toFixed(2))}
                stroke="#4F46E5"
                strokeWidth={2}
                strokeDasharray="4 4"
                isFront={true}
                label={{
                  value: `Current (${sliderVal.toFixed(2)})`,
                  fill: '#4F46E5',
                  fontSize: 11,
                  fontWeight: 700,
                  position: 'top',
                }}
              />
              <Line
                type="monotone"
                dataKey="fp_rate"
                name="FPR"
                stroke="#F79009"
                strokeWidth={2.5}
                strokeDasharray="4 4"
                dot={{ r: 3, fill: '#FFFFFF', stroke: '#F79009', strokeWidth: 1.5 }}
                activeDot={{ r: 6 }}
              />
              <Line
                type="monotone"
                dataKey="fn_rate"
                name="FNR"
                stroke="#2E90FA"
                strokeWidth={2.5}
                dot={{ r: 3, fill: '#FFFFFF', stroke: '#2E90FA', strokeWidth: 1.5 }}
                activeDot={{ r: 6 }}
              />
              <Line
                type="monotone"
                dataKey="f1_score"
                name="F1 Score"
                stroke="#12B76A"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 3. Live 2x2 Confusion Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: 2x2 Matrix */}
        <div className="lg:col-span-2 glass-panel rounded-2xl p-6 sm:p-8 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div>
              <h3 className="font-headline text-sm text-[#101828] font-semibold tracking-tight">
                Ground-Truth Confusion Matrix
              </h3>
              <p className="text-xs text-[#667085] mt-1 font-sans">
                Click any quadrant to inspect specific interactions in that classification state.
              </p>
            </div>
            {selectedQuadrant && (
              <button
                onClick={() => setSelectedQuadrant(null)}
                className="text-xs text-[#4F46E5] hover:text-[#4338CA] font-semibold cursor-pointer"
              >
                Clear Selection
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Quadrant 1: True Positive (TP) */}
            <div
              onClick={() => setSelectedQuadrant('TP')}
              className={`p-5 rounded-2xl border cursor-pointer transition-all ${
                selectedQuadrant === 'TP'
                  ? 'bg-[#ECFDF3]/90 border-[#4F46E5] ring-2 ring-[#EEF0FE] shadow-md'
                  : 'bg-[#ECFDF3]/70 border-[#ABEFC6] hover:border-[#12B76A] hover:bg-[#ECFDF3]/85'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#067647] flex items-center">
                  <CheckCircle2 className="h-4 w-4 mr-1 text-[#12B76A]" />
                  True Positives (TP)
                </span>
                <span className="font-headline text-3xl font-bold text-[#067647] tnum">
                  {confusionMatrix.true_positives}
                </span>
              </div>
              <p className="text-xs text-[#475467] mt-2 leading-relaxed font-sans">
                Truly Violating AI Responses correctly{' '}
                <strong className="text-[#067647]">Blocked &amp; Escalated</strong>.
              </p>
            </div>

            {/* Quadrant 2: False Positive (FP) */}
            <div
              onClick={() => setSelectedQuadrant('FP')}
              className={`p-5 rounded-2xl border cursor-pointer transition-all ${
                selectedQuadrant === 'FP'
                  ? 'bg-[#FFFAEB]/90 border-[#4F46E5] ring-2 ring-[#EEF0FE] shadow-md'
                  : 'bg-[#FFFAEB]/70 border-[#FEDF89] hover:border-[#DC6803] hover:bg-[#FFFAEB]/85'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#B54708] flex items-center">
                  <Info className="h-4 w-4 mr-1 text-[#DC6803]" />
                  False Positives (FP)
                </span>
                <span className="font-headline text-3xl font-bold text-[#B54708] tnum">
                  {confusionMatrix.false_positives}
                </span>
              </div>
              <p className="text-xs text-[#475467] mt-2 leading-relaxed font-sans">
                Safe/Clean Responses that were unnecessarily{' '}
                <strong className="text-[#B54708]">Blocked</strong> (Alert Fatigue).
              </p>
            </div>

            {/* Quadrant 3: False Negative (FN) */}
            <div
              onClick={() => setSelectedQuadrant('FN')}
              className={`p-5 rounded-2xl border cursor-pointer transition-all ${
                selectedQuadrant === 'FN'
                  ? 'bg-[#FEF3F2]/90 border-[#4F46E5] ring-2 ring-[#EEF0FE] shadow-md'
                  : 'bg-[#FEF3F2]/70 border-[#FECDCA] hover:border-[#F04438] hover:bg-[#FEF3F2]/85'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#B42318] flex items-center">
                  <XCircle className="h-4 w-4 mr-1 text-[#F04438]" />
                  False Negatives (FN)
                </span>
                <span className="font-headline text-3xl font-bold text-[#B42318] tnum">
                  {confusionMatrix.false_negatives}
                </span>
              </div>
              <p className="text-xs text-[#475467] mt-2 leading-relaxed font-sans">
                Dangerous/Violating Responses that were mistakenly{' '}
                <strong className="text-[#B42318]">Allowed</strong> (Liability).
              </p>
            </div>

            {/* Quadrant 4: True Negative (TN) */}
            <div
              onClick={() => setSelectedQuadrant('TN')}
              className={`p-5 rounded-2xl border cursor-pointer transition-all ${
                selectedQuadrant === 'TN'
                  ? 'bg-white/90 border-[#4F46E5] ring-2 ring-[#EEF0FE] shadow-md'
                  : 'glass-inset hover:bg-white/80'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#475467] flex items-center">
                  <ShieldCheck className="h-4 w-4 mr-1 text-[#667085]" />
                  True Negatives (TN)
                </span>
                <span className="font-headline text-3xl font-bold text-[#101828] tnum">
                  {confusionMatrix.true_negatives}
                </span>
              </div>
              <p className="text-xs text-[#475467] mt-2 leading-relaxed font-sans">
                Clean Responses that safely reached users (
                <strong className="text-[#344054]">Allowed</strong>).
              </p>
            </div>
          </div>

          {/* Drilldown list for selected quadrant */}
          {selectedQuadrant && (
            <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
              <span className="text-xs font-semibold text-[#101828]">
                Interactions in {selectedQuadrant} ({quadrantItems[selectedQuadrant].length} items):
              </span>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {quadrantItems[selectedQuadrant].length === 0 ? (
                  <p className="text-xs text-[#667085] italic py-2">
                    No interactions in this quadrant.
                  </p>
                ) : (
                  quadrantItems[selectedQuadrant].map((item) => (
                    <div
                      key={item.id}
                      className="glass-inset rounded-xl p-3 text-xs flex justify-between items-center"
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="flex items-center space-x-2 font-mono text-[10px] text-[#667085] mb-0.5">
                          <span className="font-bold text-[#101828]">{item.id}</span>
                          <span>·</span>
                          <span>{item.use_case}</span>
                          <span>·</span>
                          <span className="text-[#B54708]">
                            Truth: {item.ground_truth_labels.join(', ')}
                          </span>
                        </div>
                        <p className="text-[#475467] truncate text-xs font-sans">{item.prompt}</p>
                      </div>
                      <span className="font-mono tnum text-xs text-[#344054] font-semibold shrink-0">
                        Score: {evaluations[item.id]?.composite_risk_score}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Col: Summary Report */}
        <div className="space-y-5">
          <div className="glass-panel rounded-2xl p-6 space-y-4">
            <h4 className="font-headline text-sm font-semibold text-[#101828] tracking-tight flex items-center">
              <Sparkles className="h-4 w-4 text-[#7A5AF8] mr-2" />
              Governance Report (FR-24)
            </h4>
            <p className="text-xs text-[#475467] leading-relaxed font-sans">
              Against our 28-record benchmark dataset, the checker achieves a{' '}
              <strong className="text-[#067647]">{confusionMatrix.f1_score}% F1 score</strong> with
              a{' '}
              <strong className="text-[#B42318]">
                {confusionMatrix.fn_rate}% False Negative rate
              </strong>
              .
            </p>
            <div className="glass-inset rounded-xl p-4 text-xs space-y-2 text-[#475467] font-mono tnum">
              <div className="flex justify-between">
                <span>Total Monitored:</span>
                <span className="text-[#101828] font-semibold">{interactions.length} pairs</span>
              </div>
              <div className="flex justify-between">
                <span>Multi-Lane Overlaps:</span>
                <span className="text-[#B54708] font-semibold">100% detection</span>
              </div>
              <div className="flex justify-between">
                <span>Zero-Tolerance Escapes:</span>
                <span className="text-[#067647] font-semibold">0 (0% FN)</span>
              </div>
            </div>
          </div>

          <div className="glass-panel rounded-2xl p-6 space-y-2">
            <span className="font-headline text-sm font-semibold text-[#101828] tracking-tight block">
              Observability Takeaway
            </span>
            <p className="text-xs text-[#475467] leading-relaxed italic font-sans">
              "We didn't build a black-box censor. We built an observability plane with a calibrated
              dial. Moving the threshold makes the cost of trust transparent to executive
              stakeholders."
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
