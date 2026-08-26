/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  EvaluationResult,
  SpanHighlight,
  SyntheticInteraction,
  UseCaseId,
  VerdictTier,
} from '../types';
import { VerdictBadge } from './VerdictBadge';
import { WavyDots } from './WavyDots';
import { GeminiJudgeResultCard } from './GeminiJudgeResultCard';
import {
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  Filter,
  Search,
  Zap,
  Shield,
  Coins,
  Sparkles,
  Layers,
  Bot,
  ChevronDown,
  ChevronUp,
  Activity,
  TrendingDown,
  Loader2,
} from 'lucide-react';

interface LiveFeedTabProps {
  interactions: SyntheticInteraction[];
  evaluations: Record<string, EvaluationResult>;
  onRunJudge: (interaction: SyntheticInteraction) => Promise<any>;
  activeUseCaseFilter: UseCaseId | 'ALL';
  setActiveUseCaseFilter: (u: UseCaseId | 'ALL') => void;
  streamTrigger?: number;
  onStreamTriggerHandled?: () => void;
}

export const LiveFeedTab: React.FC<LiveFeedTabProps> = ({
  interactions,
  evaluations,
  onRunJudge,
  activeUseCaseFilter,
  setActiveUseCaseFilter,
  streamTrigger,
  onStreamTriggerHandled,
}) => {
  // Stream simulation states - only start from 1 if streamTrigger is explicitly active
  const [streamIndex, setStreamIndex] = useState<number>(
    streamTrigger && streamTrigger > 0 ? 1 : interactions.length,
  );
  const [isPlaying, setIsPlaying] = useState<boolean>(Boolean(streamTrigger && streamTrigger > 0));
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1); // 1x, 2x, 5x, 0 (instant)

  // React to new streamTrigger events (e.g. user clicked Launch Live Stream on overview)
  useEffect(() => {
    if (streamTrigger && streamTrigger > 0) {
      setStreamIndex(1);
      setIsPlaying(true);
      onStreamTriggerHandled?.();
    }
  }, [streamTrigger, onStreamTriggerHandled]);

  // Filtering states
  const [verdictFilter, setVerdictFilter] = useState<VerdictTier | 'ALL'>('ALL');
  const [anomalyFilter, setAnomalyFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Judge loading state
  const [evaluatingJudgeId, setEvaluatingJudgeId] = useState<string | null>(null);
  const [judgeResults, setJudgeResults] = useState<Record<string, any>>({});

  // Stream interval timer
  useEffect(() => {
    let timer: any;
    if (isPlaying && streamIndex < interactions.length) {
      const intervalMs = playbackSpeed === 0 ? 50 : 1800 / playbackSpeed;
      timer = setTimeout(() => {
        setStreamIndex((prev) => prev + 1);
      }, intervalMs);
    } else if (streamIndex >= interactions.length && isPlaying) {
      setIsPlaying(false);
    }
    return () => clearTimeout(timer);
  }, [isPlaying, streamIndex, interactions.length, playbackSpeed]);

  const handleReplay = () => {
    setStreamIndex(1);
    setIsPlaying(true);
  };

  const handleStep = () => {
    if (streamIndex < interactions.length) {
      setStreamIndex((prev) => prev + 1);
    }
  };

  const handleInstant = () => {
    setIsPlaying(false);
    setStreamIndex(interactions.length);
  };

  const handleSelectSpeed = (speed: number) => {
    setPlaybackSpeed(speed);
    if (streamIndex >= interactions.length) {
      setStreamIndex(1);
      setIsPlaying(true);
    }
  };

  const isAllActive = streamIndex === interactions.length && !isPlaying;

  const handleTriggerJudge = async (interaction: SyntheticInteraction) => {
    setEvaluatingJudgeId(interaction.id);
    try {
      const res = await onRunJudge(interaction);
      setJudgeResults((prev) => ({
        ...prev,
        [interaction.id]: res,
      }));
    } catch (err) {
      console.error('Judge error:', err);
    } finally {
      setEvaluatingJudgeId(null);
    }
  };

  // Visible streamed interactions
  const streamedInteractions = interactions.slice(0, streamIndex);

  // Filtered subset
  const filteredInteractions = streamedInteractions.filter((item) => {
    const evalRes = evaluations[item.id];
    if (!evalRes) return false;

    // Use case filter
    if (activeUseCaseFilter !== 'ALL' && item.use_case !== activeUseCaseFilter) {
      return false;
    }

    // Verdict filter
    if (verdictFilter !== 'ALL' && evalRes.verdict !== verdictFilter) {
      return false;
    }

    // Anomaly filter
    if (anomalyFilter === 'OVERLAP' && !evalRes.has_multi_lane_overlap) return false;
    if (anomalyFilter === 'CONFIDENTLY_WRONG' && !evalRes.performance.is_confidently_wrong)
      return false;
    if (anomalyFilter === 'PII' && evalRes.responsibility.pii_detected.length === 0) return false;
    if (anomalyFilter === 'COST' && !evalRes.cost.is_outlier) return false;
    if (anomalyFilter === 'CLEAN' && item.ground_truth_labels.some((l) => l !== 'clean'))
      return false;

    // Search query
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase();
      const matchPrompt = item.prompt.toLowerCase().includes(q);
      const matchResp = item.response.toLowerCase().includes(q);
      const matchId = item.id.toLowerCase().includes(q);
      if (!matchPrompt && !matchResp && !matchId) return false;
    }

    return true;
  });

  // Calculate live summary stats from current stream
  const totalStreamed = streamedInteractions.length;
  const totalBlocked = streamedInteractions.filter(
    (i) => evaluations[i.id]?.verdict === 'BLOCK_ESCALATE',
  ).length;
  const blockRate = totalStreamed > 0 ? ((totalBlocked / totalStreamed) * 100).toFixed(1) : '0.0';
  const totalOverlaps = streamedInteractions.filter(
    (i) => evaluations[i.id]?.has_multi_lane_overlap,
  ).length;
  const avgOverhead =
    totalStreamed > 0
      ? Math.round(
          streamedInteractions.reduce(
            (acc, i) => acc + (evaluations[i.id]?.added_overhead_latency_ms || 82),
            0,
          ) / totalStreamed,
        )
      : 82;

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
      {/* 1. Observability Stats Strip */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        {/* Hero Telemetry Card (Spans 8 cols) */}
        <div className="md:col-span-8 glass-panel glass-hover rounded-2xl p-6 sm:p-7 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none -z-10" />
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-2.5 text-[#175CD3]">
              <div className="p-1.5 rounded-xl bg-[#EFF6FF] border border-[#B2DDFF]">
                <Activity className="h-4 w-4 text-[#2E90FA]" />
              </div>
              <span className="text-[13px] text-[#101828] font-semibold">
                Global Inference Stream &amp; Latency (p99)
              </span>
            </div>
            <span className="text-[10px] px-3 py-1 rounded-full bg-[#ECFDF3]/90 border border-[#ABEFC6] text-[#067647] flex items-center gap-1.5 font-medium whitespace-nowrap shadow-xs">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-[#12B76A] opacity-60 animate-ping"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#12B76A]"></span>
              </span>
              <span>{isPlaying ? 'Streaming live pipeline' : 'Live pipeline active'}</span>
            </span>
          </div>

          <div className="my-5 flex flex-wrap items-baseline gap-4">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-4xl sm:text-5xl font-semibold text-[#101828] tracking-tight tnum">
                {totalStreamed}
              </span>
              <span className="font-mono text-xs text-[#667085] tnum">
                / {interactions.length} interactions monitored
              </span>
            </div>
            <div className="h-5 w-px bg-slate-200 hidden sm:block"></div>
            <div className="flex items-center gap-1.5 text-xs text-[#067647] font-medium bg-[#ECFDF3]/80 px-2.5 py-1 rounded-lg border border-[#ABEFC6]">
              <TrendingDown className="h-3.5 w-3.5 text-[#12B76A]" />
              <span>
                <span className="font-mono tnum">+{avgOverhead}ms</span> avg checker overhead
              </span>
            </div>
          </div>

          {/* Regional Latency & Progress Breakdown */}
          <div className="pt-3.5 border-t border-slate-200 grid grid-cols-3 gap-4 text-xs">
            <div className="glass-inset p-2.5 rounded-xl">
              <div className="text-[11px] text-[#667085] font-medium">US-East</div>
              <div className="text-[#175CD3] font-semibold text-xs mt-0.5">
                <span className="font-mono tnum">118ms</span> · RAG Active
              </div>
            </div>
            <div className="glass-inset p-2.5 rounded-xl">
              <div className="text-[11px] text-[#667085] font-medium">EU-West</div>
              <div className="text-[#6941C6] font-semibold text-xs mt-0.5">
                <span className="font-mono tnum">132ms</span> · EU AI Act
              </div>
            </div>
            <div className="glass-inset p-2.5 rounded-xl">
              <div className="text-[11px] text-[#667085] font-medium">AP-South</div>
              <div className="text-[#B54708] font-semibold text-xs mt-0.5">
                <span className="font-mono tnum">185ms</span> · Multi-Lane
              </div>
            </div>
          </div>
        </div>

        {/* Secondary Policy Blocks & Multi-Lane Card (Spans 4 cols) */}
        <div className="md:col-span-4 glass-panel glass-hover rounded-2xl p-6 sm:p-7 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/10 rounded-full blur-3xl pointer-events-none -z-10" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-xl bg-[#FEF3F2] border border-[#FECDCA]">
                <Shield className="h-4 w-4 text-[#F04438]" />
              </div>
              <span className="text-[13px] text-[#101828] font-semibold">Policy Interceptions</span>
            </div>
            <span className="text-[10px] text-[#B42318] font-semibold bg-[#FEF3F2]/90 px-2.5 py-0.5 rounded-lg border border-[#FECDCA] whitespace-nowrap shadow-xs">
              Live rate
            </span>
          </div>

          <div className="glass-inset rounded-xl p-4 my-2 text-center">
            <div className="font-display text-3xl sm:text-4xl font-semibold text-[#B42318] tracking-tight tnum">
              {blockRate}%
            </div>
            <div className="text-xs text-[#667085] mt-1 font-medium">
              <span className="font-mono tnum">{totalBlocked}</span> blocked /{' '}
              <span className="font-mono tnum">{totalOverlaps}</span> multi-lane overlaps
            </div>
          </div>

          <div className="h-2.5 w-full bg-slate-200 rounded-full overflow-hidden border border-slate-300 p-0.5">
            <div
              className="h-full bg-gradient-to-r from-[#F04438] to-[#B42318] rounded-full transition-all duration-300"
              style={{ width: `${Math.min(parseFloat(blockRate) || 0, 100)}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* 2. Streaming Playback & Filter Controls Bar */}
      <div className="glass-panel rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Stream Player Controls */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              id="btn-stream-toggle"
              onClick={() => {
                if (streamIndex >= interactions.length) {
                  setStreamIndex(1);
                  setIsPlaying(true);
                } else {
                  setIsPlaying(!isPlaying);
                }
              }}
              className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer shadow-xs ${
                isPlaying
                  ? 'bg-[#FFFAEB]/90 text-[#B54708] border border-[#FEDF89] hover:bg-[#FEF0C7]'
                  : 'glass-btn-primary text-white'
              }`}
            >
              {isPlaying ? (
                <Pause className="h-3.5 w-3.5 text-[#DC6803]" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current text-white" />
              )}
              <span>
                {isPlaying
                  ? 'Pause stream'
                  : streamIndex >= interactions.length
                    ? 'Replay stream'
                    : 'Play live feed'}
              </span>
            </button>

            <button
              id="btn-stream-step"
              onClick={handleStep}
              disabled={isPlaying || streamIndex >= interactions.length}
              className="flex items-center space-x-1 px-3.5 py-2 rounded-xl text-xs font-medium glass-btn-secondary text-[#475467] hover:text-[#101828] disabled:opacity-40 transition-all cursor-pointer"
              title="Step forward 1 interaction"
            >
              <SkipForward className="h-3.5 w-3.5" />
              <span>Step</span>
            </button>

            <button
              id="btn-stream-replay"
              onClick={handleReplay}
              className="p-2 rounded-xl glass-btn-secondary text-[#667085] hover:text-[#101828] transition-all cursor-pointer"
              title="Reset and replay stream"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>

            {/* Speed Selector */}
            <div className="flex items-center glass-inset p-1 rounded-xl font-mono text-xs">
              {[1, 2, 5].map((speed) => {
                const isSpeedActive = !isAllActive && playbackSpeed === speed;
                return (
                  <button
                    key={speed}
                    onClick={() => handleSelectSpeed(speed)}
                    className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer font-semibold ${
                      isSpeedActive
                        ? 'bg-[#4F46E5] text-white shadow-xs'
                        : 'text-[#475467] hover:text-[#101828]'
                    }`}
                  >
                    {speed}x
                  </button>
                );
              })}
              <button
                onClick={handleInstant}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer font-semibold ${
                  isAllActive
                    ? 'bg-[#4F46E5] text-white shadow-xs'
                    : 'text-[#475467] hover:text-[#101828]'
                }`}
                title="Render all interactions immediately"
              >
                All
              </button>
            </div>
          </div>

          {/* Quick Search */}
          <div className="relative flex-1 min-w-[220px] max-w-xs">
            <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#98A2B3]" />
            <input
              type="text"
              placeholder="Search prompt, response, ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full glass-input rounded-xl pl-8 pr-3 py-1.5 text-xs text-[#101828] placeholder-[#98A2B3] font-mono"
            />
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-200 text-xs">
          {/* Use Case Tabs */}
          <span className="text-[#667085] font-medium text-xs flex items-center mr-1">
            <Filter className="h-3 w-3 mr-1 text-[#98A2B3]" /> Use case:
          </span>
          {[
            { id: 'ALL', label: 'All Use Cases' },
            { id: 'support_bot', label: 'Support Bot' },
            { id: 'internal_copilot', label: 'Internal Copilot' },
            { id: 'decision_support', label: 'Decision Support' },
          ].map((u) => (
            <button
              key={u.id}
              onClick={() => setActiveUseCaseFilter(u.id as any)}
              className={`px-3 py-1 rounded-xl transition-all cursor-pointer font-medium ${
                activeUseCaseFilter === u.id
                  ? 'bg-white text-[#4F46E5] border border-[#4F46E5]/40 shadow-xs font-semibold'
                  : 'glass-inset text-[#475467] hover:text-[#101828] hover:bg-white/80'
              }`}
            >
              {u.label}
            </button>
          ))}

          <div className="h-4 w-px bg-white/60 mx-1 hidden sm:block"></div>

          {/* Verdict Filter */}
          <span className="text-[#667085] font-medium text-xs mr-1 hidden sm:inline">Verdict:</span>
          {[
            {
              id: 'ALL',
              label: 'All Tiers',
              colorClass: 'bg-white text-[#4F46E5] border-[#4F46E5]/40 shadow-xs font-semibold',
            },
            {
              id: 'ALLOW',
              label: 'Allow',
              colorClass: 'bg-[#ECFDF3] text-[#067647] border-[#ABEFC6] shadow-xs font-semibold',
            },
            {
              id: 'BADGE',
              label: 'Badge',
              colorClass: 'bg-[#EFF6FF] text-[#175CD3] border-[#B2DDFF] shadow-xs font-semibold',
            },
            {
              id: 'SOFT_CORRECT',
              label: 'Soft-Correct',
              colorClass: 'bg-[#FFFAEB] text-[#B54708] border-[#FEDF89] shadow-xs font-semibold',
            },
            {
              id: 'BLOCK_ESCALATE',
              label: 'Block',
              colorClass: 'bg-[#FEF3F2] text-[#B42318] border-[#FECDCA] shadow-xs font-semibold',
            },
          ].map((v) => (
            <button
              key={v.id}
              onClick={() => setVerdictFilter(v.id as any)}
              className={`px-2.5 py-1 rounded-xl transition-all cursor-pointer font-medium border ${
                verdictFilter === v.id
                  ? v.colorClass
                  : 'glass-inset text-[#475467] hover:text-[#101828] hover:bg-white/80'
              }`}
            >
              {v.label}
            </button>
          ))}

          <div className="h-4 w-px bg-white/60 mx-1 hidden md:block"></div>

          {/* Anomaly Category Filter */}
          <select
            value={anomalyFilter}
            onChange={(e) => setAnomalyFilter(e.target.value)}
            className="glass-input rounded-xl px-3 py-1 text-xs text-[#101828] cursor-pointer"
          >
            <option value="ALL">All Anomaly Types</option>
            <option value="OVERLAP">Multi-Lane Overlaps Only</option>
            <option value="CONFIDENTLY_WRONG">Confidently Wrong (Performance)</option>
            <option value="PII">PII Leaks (Responsibility)</option>
            <option value="COST">Cost/Token Outliers</option>
            <option value="CLEAN">Clean Ground Truth</option>
          </select>
        </div>
      </div>

      {/* 3. Interaction Feed List */}
      <div className="space-y-4">
        {filteredInteractions.length === 0 ? (
          <div className="glass-panel rounded-2xl p-12 text-center">
            <Bot className="h-10 w-10 text-[#98A2B3] mx-auto mb-3" />
            <p className="text-sm font-semibold text-[#101828]">
              No interactions match the selected filters.
            </p>
            <p className="text-xs text-[#667085] mt-1">
              Try relaxing your filter criteria or stepping the stream forward.
            </p>
          </div>
        ) : (
          filteredInteractions.map((item, index) => {
            const evalRes = evaluations[item.id];
            if (!evalRes) return null;

            const isExpanded = expandedId === item.id;
            const judgeData = judgeResults[item.id];

            return (
              <div
                key={item.id}
                id={`interaction-${item.id}`}
                className={`glass-panel rounded-2xl overflow-hidden transition-all ${
                  isExpanded
                    ? 'border-[#4F46E5] ring-2 ring-[#EEF0FE] shadow-lg'
                    : evalRes.verdict === 'BLOCK_ESCALATE'
                      ? 'hover:border-[#F04438]/60'
                      : evalRes.verdict === 'SOFT_CORRECT'
                        ? 'hover:border-[#DC6803]/60'
                        : evalRes.verdict === 'BADGE'
                          ? 'hover:border-[#2E90FA]/60'
                          : 'hover:border-[#12B76A]/60'
                }`}
              >
                {/* Interaction Main Header Row */}
                <div
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                  className="p-5 cursor-pointer hover:bg-white/50 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  {/* Left: Metadata & Prompt Summary */}
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex items-center flex-wrap gap-2 text-xs">
                      <span className="text-[#98A2B3] font-mono font-semibold tnum">
                        #{index + 1}
                      </span>
                      <span className="text-[#101828] font-mono font-semibold tnum">{item.id}</span>

                      {/* Use Case Chip */}
                      <span className="px-2.5 py-0.5 rounded-lg glass-inset text-[#475467] font-medium text-[11px]">
                        {item.use_case === 'support_bot'
                          ? 'Support Bot'
                          : item.use_case === 'internal_copilot'
                            ? 'Internal Copilot'
                            : 'Decision Support'}
                      </span>

                      {/* Multilabel Overlap Tag */}
                      {evalRes.has_multi_lane_overlap && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg bg-[#FFFAEB]/85 border border-[#FEDF89] text-[#B54708] font-medium text-[11px] shadow-xs">
                          <Layers className="h-3 w-3 mr-1 text-[#DC6803]" />
                          Multi-Lane ({evalRes.overlapping_lanes.length})
                        </span>
                      )}

                      {/* Ground Truth Pill */}
                      <span className="text-[10px] text-[#667085] glass-inset px-2 py-0.5 rounded-lg font-medium">
                        Truth: {item.ground_truth_labels.join(', ')}
                      </span>
                    </div>

                    {/* Prompt Title */}
                    <div className="text-sm font-medium text-[#101828] truncate font-sans">
                      {item.prompt}
                    </div>
                  </div>

                  {/* Right: Three Lane Metric Chips & Verdict Badge */}
                  <div className="flex items-center flex-wrap md:flex-nowrap gap-2">
                    {/* Performance Lane Chip */}
                    <div
                      className={`px-2.5 py-1 rounded-xl text-xs border flex items-center space-x-1.5 font-medium shadow-xs backdrop-blur-md ${
                        evalRes.performance.is_confidently_wrong
                          ? 'bg-[#FEF3F2]/90 border-[#FECDCA] text-[#B42318]'
                          : 'bg-[#EFF6FF]/90 border-[#B2DDFF] text-[#175CD3]'
                      }`}
                      title={`Performance Lane: Groundedness ${(evalRes.performance.groundedness_score * 100).toFixed(0)}%`}
                    >
                      <Zap
                        className={`h-3 w-3 ${evalRes.performance.is_confidently_wrong ? 'text-[#F04438]' : 'text-[#2E90FA]'}`}
                      />
                      <span className="font-mono tnum">
                        {(evalRes.performance.groundedness_score * 100).toFixed(0)}%
                      </span>
                      {evalRes.performance.is_confidently_wrong && (
                        <span className="text-[9px] bg-white text-[#B42318] border border-[#FECDCA] px-1 rounded-md font-semibold">
                          CW
                        </span>
                      )}
                    </div>

                    {/* Cost Lane Chip */}
                    <div
                      className={`px-2.5 py-1 rounded-xl text-xs border flex items-center space-x-1.5 font-medium shadow-xs backdrop-blur-md ${
                        evalRes.cost.is_outlier
                          ? 'bg-[#FFFAEB]/90 border-[#FEDF89] text-[#B54708]'
                          : 'glass-inset text-[#475467]'
                      }`}
                      title={`Cost Lane: Token Z-Score ${evalRes.cost.token_z_score}`}
                    >
                      <Coins
                        className={`h-3 w-3 ${evalRes.cost.is_outlier ? 'text-[#DC6803]' : 'text-[#98A2B3]'}`}
                      />
                      <span className="font-mono tnum">{item.token_count.total}t</span>
                    </div>

                    {/* Responsibility Lane Chip */}
                    <div
                      className={`px-2.5 py-1 rounded-xl text-xs border flex items-center space-x-1.5 font-medium shadow-xs backdrop-blur-md ${
                        evalRes.responsibility.risk_score > 0.4
                          ? 'bg-[#F4F3FF]/90 border-[#D9D6FE] text-[#6941C6]'
                          : 'glass-inset text-[#475467]'
                      }`}
                      title={`Responsibility Lane: ${evalRes.responsibility.pii_detected.length} PII detected`}
                    >
                      <Shield
                        className={`h-3 w-3 ${evalRes.responsibility.risk_score > 0.4 ? 'text-[#7A5AF8]' : 'text-[#98A2B3]'}`}
                      />
                      <span>
                        {evalRes.responsibility.pii_detected.length > 0
                          ? `PII (${evalRes.responsibility.pii_detected.length})`
                          : evalRes.responsibility.bias_flags.length > 0
                            ? 'Bias'
                            : 'Clean'}
                      </span>
                    </div>

                    {/* Overhead */}
                    <div className="text-xs text-[#667085] font-mono tnum hidden xl:block">
                      +{evalRes.added_overhead_latency_ms}ms
                    </div>

                    {/* Verdict Badge */}
                    <VerdictBadge verdict={evalRes.verdict} size="sm" />

                    {/* Expand Toggle */}
                    <button className="text-[#98A2B3] hover:text-[#101828] p-1.5 rounded-lg hover:bg-white/60 transition-colors">
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Expanded Inspection Drawer */}
                {isExpanded && (
                  <div className="p-6 bg-slate-50/50 border-t border-slate-200 space-y-6 backdrop-blur-md">
                    {/* Multilabel Overlap Alert Banner */}
                    {evalRes.has_multi_lane_overlap && (
                      <div className="bg-[#FFFAEB]/85 border border-[#FEDF89] rounded-xl p-4 flex items-start space-x-3 shadow-xs">
                        <Layers className="h-5 w-5 text-[#DC6803] shrink-0 mt-0.5" />
                        <div>
                          <div className="text-[13px] font-semibold text-[#B54708]">
                            Multi-lane overlap detected ({evalRes.overlapping_lanes.length} active
                            vectors)
                          </div>
                          <p className="text-xs text-[#475467] mt-1 font-sans leading-relaxed">
                            This response tripped multiple governance lanes simultaneously:{' '}
                            <span className="font-semibold text-[#101828]">
                              {evalRes.overlapping_lanes.join(' + ')}
                            </span>
                            . ControlPlane Checker isolates concurrent failure vectors without
                            collapsing to a single label.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Dual Pane: User Input & Context vs AI Response */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Left Pane: Prompt & Retrieved Context */}
                      <div className="space-y-4">
                        <div className="glass-inset rounded-xl p-4 space-y-2">
                          <span className="text-[11px] text-[#667085] block font-medium">
                            User prompt
                          </span>
                          <p className="text-sm text-[#101828] font-sans leading-relaxed">
                            {item.prompt}
                          </p>
                        </div>

                        <div className="glass-inset rounded-xl p-4 space-y-2">
                          <div className="flex justify-between items-center gap-2">
                            <span className="text-[11px] text-[#667085] font-medium">
                              Retrieved context (governance source)
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-lg bg-[#F4F3FF] border border-[#D9D6FE] text-[#6941C6] font-medium whitespace-nowrap">
                              {item.retrieved_context
                                ? 'Vector RAG Context'
                                : 'No Context / Unverified'}
                            </span>
                          </div>
                          <p className="text-xs text-[#344054] leading-relaxed italic bg-white/90 p-3 rounded-lg border border-slate-200 font-sans">
                            {item.retrieved_context ||
                              '[No retrieval context attached. Evaluated against certainty heuristic.]'}
                          </p>
                        </div>
                      </div>

                      {/* Right Pane: AI Response with Span Annotations */}
                      <div className="glass-inset rounded-xl p-4 flex flex-col justify-between space-y-4">
                        <div>
                          <div className="flex justify-between items-center mb-2 gap-2">
                            <span className="text-[11px] text-[#667085] font-medium flex items-center gap-2">
                              AI model response
                              {evalRes.verdict === 'BLOCK_ESCALATE' && (
                                <span className="text-[10px] font-semibold text-[#B42318] bg-[#FEF3F2] px-2 py-0.5 rounded-lg border border-[#FECDCA] whitespace-nowrap">
                                  Withheld from user
                                </span>
                              )}
                            </span>
                            <span className="font-mono text-[10px] text-[#667085] tnum whitespace-nowrap">
                              {item.token_count.completion} tokens · {item.latency_ms}ms
                            </span>
                          </div>

                          <div className="bg-white/90 border border-slate-200 rounded-xl p-4 min-h-[100px] shadow-inner">
                            {renderHighlightedResponse(item.response, evalRes)}
                          </div>
                        </div>

                        {/* Triggering Spans legend */}
                        {(evalRes.performance.triggering_spans.length > 0 ||
                          evalRes.responsibility.triggering_spans.length > 0) && (
                          <div className="pt-3 border-t border-slate-200 text-xs space-y-1.5">
                            <span className="text-[#667085] font-medium text-[11px] block">
                              Triggering violations
                            </span>
                            <div className="flex flex-wrap gap-2">
                              {evalRes.performance.triggering_spans.map((s, idx) => (
                                <span
                                  key={`perf-${idx}`}
                                  className="px-2.5 py-0.5 rounded-lg bg-[#FEF3F2]/90 text-[#B42318] border border-[#FECDCA] text-[10px] font-medium shadow-xs"
                                >
                                  Claim Mismatch: "{s.text}"
                                </span>
                              ))}
                              {evalRes.responsibility.triggering_spans.map((s, idx) => (
                                <span
                                  key={`resp-${idx}`}
                                  className={`px-2.5 py-0.5 rounded-lg text-[10px] font-medium border shadow-xs ${
                                    s.type === 'pii'
                                      ? 'bg-[#FFFAEB]/90 text-[#B54708] border-[#FEDF89]'
                                      : 'bg-[#F4F3FF]/90 text-[#6941C6] border-[#D9D6FE]'
                                  }`}
                                >
                                  {s.type.toUpperCase()}: "{s.text}"
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Three Detailed Lane Deep Dives */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Lane 1 - Performance */}
                      <div className="glass-panel rounded-xl p-4 space-y-3 shadow-xs">
                        <div className="flex items-center justify-between text-xs font-semibold text-[#175CD3]">
                          <span className="flex items-center gap-1.5">
                            <Zap className="h-3.5 w-3.5 text-[#2E90FA]" /> Performance lane
                          </span>
                          <span className="font-mono tnum">
                            {(evalRes.performance.groundedness_score * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div className="text-xs text-[#475467] space-y-1">
                          <div className="flex justify-between gap-2">
                            <span className="text-[#667085]">Groundedness</span>
                            <span className="text-[#101828] font-mono font-medium tnum">
                              {evalRes.performance.groundedness_score}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-[#667085]">Certainty</span>
                            <span className="text-[#101828] font-mono font-medium tnum">
                              {evalRes.performance.certainty_score}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-[#667085]">Mismatch</span>
                            <span className="text-[#B42318] font-mono font-semibold tnum">
                              {evalRes.performance.certainty_support_mismatch}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-[#667085] pt-2 border-t border-slate-200 font-sans leading-relaxed">
                          {evalRes.performance.explanation}
                        </p>
                      </div>

                      {/* Lane 2 - Cost */}
                      <div className="glass-panel rounded-xl p-4 space-y-3 shadow-xs">
                        <div className="flex items-center justify-between text-xs font-semibold text-[#B54708]">
                          <span className="flex items-center gap-1.5">
                            <Coins className="h-3.5 w-3.5 text-[#DC6803]" /> Cost lane
                          </span>
                          <span className="font-mono tnum">Z: {evalRes.cost.combined_z_score}</span>
                        </div>
                        <div className="text-xs text-[#475467] space-y-1">
                          <div className="flex justify-between gap-2">
                            <span className="text-[#667085]">Baseline tokens</span>
                            <span className="text-[#101828] font-mono font-medium tnum">
                              {evalRes.cost.baseline_mean_tokens}t
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-[#667085]">Actual tokens</span>
                            <span className="text-[#101828] font-mono font-medium tnum">
                              {item.token_count.total}t
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-[#667085]">Baseline latency</span>
                            <span className="text-[#101828] font-mono font-medium tnum">
                              {evalRes.cost.baseline_mean_latency_ms}ms
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-[#667085] pt-2 border-t border-slate-200 font-sans leading-relaxed">
                          {evalRes.cost.explanation}
                        </p>
                      </div>

                      {/* Lane 3 - Responsibility */}
                      <div className="glass-panel rounded-xl p-4 space-y-3 shadow-xs">
                        <div className="flex items-center justify-between text-xs font-semibold text-[#6941C6]">
                          <span className="flex items-center gap-1.5">
                            <Shield className="h-3.5 w-3.5 text-[#7A5AF8]" /> Responsibility
                          </span>
                          <span className="font-mono tnum">
                            Risk: {evalRes.responsibility.risk_score}
                          </span>
                        </div>
                        <div className="text-xs text-[#475467] space-y-1">
                          <div className="flex justify-between gap-2">
                            <span className="text-[#667085]">PII entities</span>
                            <span className="text-[#B54708] font-medium text-right">
                              {evalRes.responsibility.pii_detected.length > 0
                                ? evalRes.responsibility.pii_detected.map((p) => p.type).join(', ')
                                : 'None'}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-[#667085]">Bias categories</span>
                            <span className="text-[#6941C6] font-medium text-right">
                              {evalRes.responsibility.bias_flags.length > 0
                                ? evalRes.responsibility.bias_flags[0]
                                : 'None'}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-[#667085]">Regulatory</span>
                            <span className="text-[#067647] font-medium">
                              {evalRes.responsibility.policy_violations.length > 0
                                ? 'Violated'
                                : 'Passed'}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-[#667085] pt-2 border-t border-slate-200 font-sans leading-relaxed">
                          {evalRes.responsibility.explanation}
                        </p>
                      </div>
                    </div>

                    {/* Session Accumulator & Gemini Judge Action */}
                    <div className="flex flex-wrap items-center justify-between gap-4 glass-panel rounded-xl p-4 shadow-xs">
                      <div className="flex items-center space-x-3 text-xs">
                        <span className="text-[#667085] font-medium">
                          Session risk accumulator (
                          <span className="font-mono tnum">{item.session_id}</span>)
                        </span>
                        <div className="flex items-center space-x-2">
                          <div className="w-28 h-2.5 bg-slate-200 rounded-full overflow-hidden border border-slate-300 p-0.5">
                            <div
                              className={`h-full rounded-full ${
                                evalRes.session_accumulated_risk > 0.6
                                  ? 'bg-[#F04438]'
                                  : evalRes.session_accumulated_risk > 0.35
                                    ? 'bg-[#DC6803]'
                                    : 'bg-[#12B76A]'
                              } transition-all duration-300`}
                              style={{ width: `${evalRes.session_accumulated_risk * 100}%` }}
                            ></div>
                          </div>
                          <span className="font-semibold text-[#101828] font-mono tnum">
                            {(evalRes.session_accumulated_risk * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>

                      {/* Trigger LLM Judge Button */}
                      <button
                        onClick={() => handleTriggerJudge(item)}
                        disabled={evaluatingJudgeId === item.id}
                        className="inline-flex items-center space-x-2 px-5 py-2 rounded-xl text-xs font-medium glass-btn-primary text-white disabled:opacity-50 transition-all cursor-pointer"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>
                          {evaluatingJudgeId === item.id
                            ? 'Evaluating with Gemini'
                            : judgeData
                              ? 'Re-evaluate with Judge'
                              : 'Run Live Gemini Judge Tiebreaker'}
                        </span>
                        {evaluatingJudgeId === item.id && (
                          <WavyDots color="bg-white" size="xs" className="ml-1" />
                        )}
                      </button>
                    </div>

                    {/* Live Judge Results Display */}
                    {judgeData && <GeminiJudgeResultCard judgeData={judgeData} />}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Active Stream Ingestion Circular Loader - Minimal & Clean */}
        {isPlaying && streamIndex < interactions.length && (
          <div className="glass-panel border-dashed border-[#B2DDFF] bg-[#EFF6FF]/50 rounded-2xl p-4 flex items-center justify-between gap-4 backdrop-blur-md transition-all">
            <div className="flex items-center space-x-3">
              <Loader2 className="h-4 w-4 text-[#2E90FA] animate-spin shrink-0" />
              <div>
                <span className="text-xs font-semibold text-[#175CD3] font-headline tracking-tight">
                  Streaming interaction #{streamIndex + 1} of {interactions.length}...
                </span>
                <span className="text-[11px] text-[#667085] ml-2 font-sans hidden sm:inline">
                  Evaluating 3-lane risk telemetry in real-time
                </span>
              </div>
            </div>
            <span className="text-[10px] font-mono text-[#175CD3] bg-white/90 border border-[#B2DDFF] px-2.5 py-0.5 rounded-lg shrink-0 shadow-xs">
              {playbackSpeed}x speed
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
