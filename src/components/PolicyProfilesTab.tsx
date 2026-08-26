/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { GeographyRuleset, PolicyProfile, UseCaseId } from '../types';
import { policyToYaml } from '../lib/policyProfiles';
import {
  Sliders,
  FileCode,
  Copy,
  Check,
  RotateCcw,
  Globe2,
  ShieldAlert,
  SlidersHorizontal,
  Layers,
  Sparkles,
} from 'lucide-react';

interface PolicyProfilesTabProps {
  policyProfiles: Record<UseCaseId, PolicyProfile>;
  onUpdateProfile: (useCase: UseCaseId, updated: PolicyProfile) => void;
  onResetProfiles: () => void;
  activeUseCase: UseCaseId;
  setActiveUseCase: (u: UseCaseId) => void;
}

export const PolicyProfilesTab: React.FC<PolicyProfilesTabProps> = ({
  policyProfiles,
  onUpdateProfile,
  onResetProfiles,
  activeUseCase,
  setActiveUseCase,
}) => {
  const [viewMode, setViewMode] = useState<'visual' | 'yaml'>('visual');
  const [copied, setCopied] = useState<boolean>(false);

  const currentProfile = policyProfiles[activeUseCase];

  const handleCopyYaml = () => {
    const yaml = policyToYaml(currentProfile);
    navigator.clipboard.writeText(yaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePresetApply = (presetType: 'strict' | 'balanced' | 'permissive') => {
    const baseVersion = currentProfile.version.split('-')[0] || '1.0.0';
    const suffix = presetType === 'permissive' ? 'fast' : presetType;
    const newVersion = `${baseVersion}-${suffix}`;

    let newProfile: PolicyProfile;

    if (presetType === 'strict') {
      newProfile = {
        ...currentProfile,
        version: newVersion,
        thresholds: {
          ...currentProfile.thresholds,
          block_escalate: 0.50,
          soft_correct: 0.30,
          badge: 0.15,
          hallucination_cutoff: 0.30,
          pii_severity_cutoff: 0.15,
          toxicity_cutoff: 0.20,
          cost_z_score_cutoff: 1.8,
        },
      };
    } else if (presetType === 'permissive') {
      newProfile = {
        ...currentProfile,
        version: newVersion,
        thresholds: {
          ...currentProfile.thresholds,
          block_escalate: 0.85,
          soft_correct: 0.60,
          badge: 0.35,
          hallucination_cutoff: 0.55,
          pii_severity_cutoff: 0.50,
          toxicity_cutoff: 0.60,
          cost_z_score_cutoff: 3.5,
        },
      };
    } else {
      // Balanced
      newProfile = {
        ...currentProfile,
        version: newVersion,
        thresholds: {
          ...currentProfile.thresholds,
          block_escalate: 0.65,
          soft_correct: 0.40,
          badge: 0.22,
          hallucination_cutoff: 0.40,
          pii_severity_cutoff: 0.30,
          toxicity_cutoff: 0.35,
          cost_z_score_cutoff: 2.2,
        },
      };
    }

    onUpdateProfile(activeUseCase, newProfile);
  };

  return (
    <div className="space-y-6">
      {/* 1. Top Bar: Use Case Selector & View Mode Toggle */}
      <div className="glass-panel rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        {/* Use Case Tabs */}
        <div className="flex items-center gap-3 text-xs">
          <span className="text-[13px] text-[#667085] font-medium mr-1 hidden sm:inline">
            Use case
          </span>
          <div className="glass-inset p-1 rounded-xl inline-flex items-center gap-1">
            {[
              { id: 'support_bot', label: 'Support Bot' },
              { id: 'internal_copilot', label: 'Internal Copilot' },
              { id: 'decision_support', label: 'Decision Support' },
            ].map((u) => (
              <button
                key={u.id}
                onClick={() => setActiveUseCase(u.id as UseCaseId)}
                className={`px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-all cursor-pointer ${
                  activeUseCase === u.id
                    ? 'bg-white text-[#101828] shadow-xs font-semibold'
                    : 'text-[#667085] hover:text-[#101828]'
                }`}
              >
                {u.label}
              </button>
            ))}
          </div>
        </div>

        {/* View Mode & Actions */}
        <div className="flex items-center gap-3 text-xs">
          <div className="glass-inset p-1 rounded-xl inline-flex items-center gap-1">
            <button
              onClick={() => setViewMode('visual')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-all cursor-pointer ${
                viewMode === 'visual' ? 'bg-white text-[#101828] shadow-xs font-semibold' : 'text-[#667085] hover:text-[#101828]'
              }`}
            >
              <Sliders className="h-3.5 w-3.5 text-[#4F46E5]" />
              <span>Policy Studio</span>
            </button>
            <button
              onClick={() => setViewMode('yaml')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-all cursor-pointer ${
                viewMode === 'yaml' ? 'bg-white text-[#101828] shadow-xs font-semibold' : 'text-[#667085] hover:text-[#101828]'
              }`}
            >
              <FileCode className="h-3.5 w-3.5 text-[#7A5AF8]" />
              <span>YAML Code</span>
            </button>
          </div>

          <button
            onClick={onResetProfiles}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl glass-btn-secondary text-[#475467] hover:text-[#B42318] text-[13px] font-medium transition-colors cursor-pointer"
            title="Reset all policies to default values"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        </div>
      </div>

      {/* 2. Hot Rescore Notification Banner */}
      <div className="glass-panel rounded-2xl p-4 flex items-center justify-between gap-4 text-xs text-[#3F3BAF] border-[#D9D6FE]/80 bg-[#EEF0FE]/75">
        <div className="flex items-center space-x-3">
          <div className="p-1.5 rounded-xl bg-white/80 border border-[#D9D6FE] text-[#4F46E5] shrink-0 shadow-xs">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="font-sans">
            <strong className="text-[#101828] font-semibold">Zero-Downtime Hot Rescore:</strong> Modifying any threshold or weight below immediately re-evaluates the entire dataset and updates Live Stream &amp; Trust Metrics in real time.
          </span>
        </div>
        <span className="font-mono text-[10px] text-[#4F46E5] bg-white/90 px-3 py-1 rounded-lg border border-[#D9D6FE] tnum font-semibold shrink-0 whitespace-nowrap shadow-xs">
          Live Hot-Reload
        </span>
      </div>

      {/* 3. Main Content: Visual Studio OR YAML Editor */}
      {viewMode === 'visual' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Cols: Interactive Visual Studio */}
          <div className="lg:col-span-2 space-y-6">
            {/* Presets Strip */}
            <div className="glass-panel rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <span className="font-headline text-lg text-[#101828] font-semibold tracking-tight">
                  Quick Policy Presets
                </span>
                <span className="text-xs text-[#98A2B3] font-medium">Apply standard archetype</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <button
                  onClick={() => handlePresetApply('strict')}
                  className="p-4 rounded-xl glass-inset hover:bg-white/90 text-left transition-all cursor-pointer group shadow-xs hover:border-[#4F46E5]"
                >
                  <div className="text-[13px] text-[#101828] font-semibold group-hover:text-[#4F46E5] transition-colors">Strict Enterprise</div>
                  <div className="text-[11px] text-[#667085] mt-1 font-sans">High defense, lower block cutoff (0.50)</div>
                </button>
                <button
                  onClick={() => handlePresetApply('balanced')}
                  className="p-4 rounded-xl glass-inset hover:bg-white/90 text-left transition-all cursor-pointer group shadow-xs hover:border-[#4F46E5]"
                >
                  <div className="text-[13px] text-[#101828] font-semibold group-hover:text-[#4F46E5] transition-colors">Balanced Standard</div>
                  <div className="text-[11px] text-[#667085] mt-1 font-sans">Optimal FP/FN trade-off (0.65)</div>
                </button>
                <button
                  onClick={() => handlePresetApply('permissive')}
                  className="p-4 rounded-xl glass-inset hover:bg-white/90 text-left transition-all cursor-pointer group shadow-xs hover:border-[#4F46E5]"
                >
                  <div className="text-[13px] text-[#101828] font-semibold group-hover:text-[#4F46E5] transition-colors">High Throughput</div>
                  <div className="text-[11px] text-[#667085] mt-1 font-sans">Low friction, higher cutoff (0.85)</div>
                </button>
              </div>
            </div>

            {/* Verdict Tier Boundary Sliders */}
            <div className="glass-panel rounded-2xl p-6 space-y-6">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <span className="font-headline text-lg text-[#101828] font-semibold tracking-tight flex items-center">
                  <SlidersHorizontal className="h-4 w-4 mr-2 text-[#4F46E5]" />
                  Verdict Tier Thresholds (Decision Engine)
                </span>
                <span className="text-xs text-[#98A2B3] font-medium">
                  Autonomous 4-Tier Routing
                </span>
              </div>

              {/* Block + Escalate Slider */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[13px] text-[#344054] font-medium flex items-center gap-1.5">
                    <ShieldAlert className="h-3.5 w-3.5 text-[#F04438]" /> Block + Escalate cutoff
                  </span>
                  <span className="font-mono text-xs tnum text-[#B42318] bg-white border border-[#FECDCA] rounded-lg px-2.5 py-0.5 font-bold shadow-xs">
                    &gt;= {currentProfile.thresholds.block_escalate.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.30"
                  max="0.90"
                  step="0.05"
                  value={currentProfile.thresholds.block_escalate}
                  onChange={(e) =>
                    onUpdateProfile(activeUseCase, {
                      ...currentProfile,
                      thresholds: {
                        ...currentProfile.thresholds,
                        block_escalate: parseFloat(e.target.value),
                      },
                    })
                  }
                  className="w-full h-2.5 bg-slate-300 hover:bg-slate-400/70 border border-slate-400 rounded-full cursor-pointer shadow-inner accent-[#F04438] transition-colors"
                />
                <p className="text-[11px] text-[#667085] leading-relaxed font-sans">
                  Scores above this threshold withhold the model response and route it to Frontline Review.
                </p>
              </div>

              {/* Soft-Correct Slider */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[13px] text-[#344054] font-medium">
                    Soft-Correct (inline caveat) cutoff
                  </span>
                  <span className="font-mono text-xs tnum text-[#B54708] bg-white border border-[#FEDF89] rounded-lg px-2.5 py-0.5 font-bold shadow-xs">
                    &gt;= {currentProfile.thresholds.soft_correct.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.20"
                  max="0.70"
                  step="0.05"
                  value={currentProfile.thresholds.soft_correct}
                  onChange={(e) =>
                    onUpdateProfile(activeUseCase, {
                      ...currentProfile,
                      thresholds: {
                        ...currentProfile.thresholds,
                        soft_correct: parseFloat(e.target.value),
                      },
                    })
                  }
                  className="w-full h-2.5 bg-slate-300 hover:bg-slate-400/70 border border-slate-400 rounded-full cursor-pointer shadow-inner accent-[#DC6803] transition-colors"
                />
                <p className="text-[11px] text-[#667085] leading-relaxed font-sans">
                  Displays an inline warning badge and confidence footnote alongside the response.
                </p>
              </div>

              {/* Badge Slider */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[13px] text-[#344054] font-medium">
                    Ambient trust badge cutoff
                  </span>
                  <span className="font-mono text-xs tnum text-[#175CD3] bg-white border border-[#B2DDFF] rounded-lg px-2.5 py-0.5 font-bold shadow-xs">
                    &gt;= {currentProfile.thresholds.badge.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.10"
                  max="0.45"
                  step="0.05"
                  value={currentProfile.thresholds.badge}
                  onChange={(e) =>
                    onUpdateProfile(activeUseCase, {
                      ...currentProfile,
                      thresholds: {
                        ...currentProfile.thresholds,
                        badge: parseFloat(e.target.value),
                      },
                    })
                  }
                  className="w-full h-2.5 bg-slate-300 hover:bg-slate-400/70 border border-slate-400 rounded-full cursor-pointer shadow-inner accent-[#2E90FA] transition-colors"
                />
              </div>
            </div>

            {/* Lane Weights Distribution */}
            <div className="glass-panel rounded-2xl p-6 space-y-6">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <span className="font-headline text-lg text-[#101828] font-semibold tracking-tight flex items-center">
                  <Layers className="h-4 w-4 mr-2 text-[#4F46E5]" />
                  Lane Weights Composition
                </span>
                <span className="font-mono text-xs text-[#667085] tnum">
                  P: <span className="text-[#175CD3] font-semibold">{(currentProfile.lane_weights.performance * 100).toFixed(0)}%</span> · C: <span className="text-[#B54708] font-semibold">{(currentProfile.lane_weights.cost * 100).toFixed(0)}%</span> · R: <span className="text-[#6941C6] font-semibold">{(currentProfile.lane_weights.responsibility * 100).toFixed(0)}%</span>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                {/* Performance Weight */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[13px] text-[#344054] font-medium">Performance</span>
                    <span className="font-mono text-xs tnum text-[#175CD3] bg-white border border-[#B2DDFF] rounded-lg px-2 py-0.5 font-bold shadow-xs">{(currentProfile.lane_weights.performance * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.10"
                    max="0.80"
                    step="0.05"
                    value={currentProfile.lane_weights.performance}
                    onChange={(e) =>
                      onUpdateProfile(activeUseCase, {
                        ...currentProfile,
                        lane_weights: {
                          ...currentProfile.lane_weights,
                          performance: parseFloat(e.target.value),
                        },
                      })
                    }
                    className="w-full h-2.5 bg-slate-300 hover:bg-slate-400/70 border border-slate-400 rounded-full cursor-pointer shadow-inner accent-[#175CD3] transition-colors"
                  />
                </div>

                {/* Cost Weight */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[13px] text-[#344054] font-medium">Cost</span>
                    <span className="font-mono text-xs tnum text-[#B54708] bg-white border border-[#FEDF89] rounded-lg px-2 py-0.5 font-bold shadow-xs">{(currentProfile.lane_weights.cost * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.05"
                    max="0.60"
                    step="0.05"
                    value={currentProfile.lane_weights.cost}
                    onChange={(e) =>
                      onUpdateProfile(activeUseCase, {
                        ...currentProfile,
                        lane_weights: {
                          ...currentProfile.lane_weights,
                          cost: parseFloat(e.target.value),
                        },
                      })
                    }
                    className="w-full h-2.5 bg-slate-300 hover:bg-slate-400/70 border border-slate-400 rounded-full cursor-pointer shadow-inner accent-[#B54708] transition-colors"
                  />
                </div>

                {/* Responsibility Weight */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[13px] text-[#344054] font-medium">Responsibility</span>
                    <span className="font-mono text-xs tnum text-[#6941C6] bg-white border border-[#D9D6FE] rounded-lg px-2 py-0.5 font-bold shadow-xs">{(currentProfile.lane_weights.responsibility * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.10"
                    max="0.80"
                    step="0.05"
                    value={currentProfile.lane_weights.responsibility}
                    onChange={(e) =>
                      onUpdateProfile(activeUseCase, {
                        ...currentProfile,
                        lane_weights: {
                          ...currentProfile.lane_weights,
                          responsibility: parseFloat(e.target.value),
                        },
                      })
                    }
                    className="w-full h-2.5 bg-slate-300 hover:bg-slate-400/70 border border-slate-400 rounded-full cursor-pointer shadow-inner accent-[#6941C6] transition-colors"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Right Col: Runtime Governance & Ruleset Config */}
          <div className="space-y-6">
            {/* Geography & Regulatory Ruleset */}
            <div className="glass-panel rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2 font-headline text-lg text-[#101828] font-semibold tracking-tight">
                <Globe2 className="h-5 w-5 text-[#099250]" />
                <span>Regulatory Jurisdiction</span>
              </div>

              <div className="space-y-2">
                <label className="text-[13px] text-[#344054] font-medium block">
                  Active ruleset version
                </label>
                <select
                  value={currentProfile.geography_ruleset}
                  onChange={(e) =>
                    onUpdateProfile(activeUseCase, {
                      ...currentProfile,
                      geography_ruleset: e.target.value as GeographyRuleset,
                    })
                  }
                  className="w-full glass-input rounded-xl p-3 text-xs text-[#101828] cursor-pointer"
                >
                  <option value="EU_AI_ACT_STANDARD">EU AI Act (High-Risk AI &amp; GDPR Art 5)</option>
                  <option value="US_HIPAA_FINRA">US Financial &amp; Health (GLBA / ECOA / HIPAA)</option>
                  <option value="INDIA_DPDP_ACT">India DPDPA 2023 (Digital Personal Data)</option>
                  <option value="INTERNAL_IP_SECURITY">Internal Corp Security (SEC-804 IP)</option>
                </select>
                <p className="text-[11px] text-[#667085] leading-relaxed">
                  Enforces domain-specific compliance assertions without modifying model backend code.
                </p>
              </div>

              {/* Pre-response blocking toggle */}
              <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
                <div>
                  <span className="text-[13px] text-[#344054] font-medium block">
                    Pre-Response Blocking
                  </span>
                  <span className="text-[11px] text-[#667085]">
                    Wait for lane check before streaming
                  </span>
                </div>
                <label className="relative inline-flex items-center gap-2.5 cursor-pointer select-none group">
                  <input
                    type="checkbox"
                    checked={currentProfile.pre_response_blocking}
                    onChange={(e) =>
                      onUpdateProfile(activeUseCase, {
                        ...currentProfile,
                        pre_response_blocking: e.target.checked,
                      })
                    }
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#4F46E5] transition-colors shadow-inner"></div>
                  <span
                    className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md transition-colors ${
                      currentProfile.pre_response_blocking
                        ? 'bg-[#EEF0FE] text-[#4F46E5] border border-[#D9D6FE]'
                        : 'bg-slate-100 text-[#667085] border border-slate-200'
                    }`}
                  >
                    {currentProfile.pre_response_blocking ? 'ON' : 'OFF'}
                  </span>
                </label>
              </div>

              {/* Latency Budget */}
              <div className="space-y-2 pt-2">
                <div className="flex justify-between items-center">
                  <span className="text-[13px] text-[#344054] font-medium">Latency target</span>
                  <span className="font-mono text-xs tnum text-[#101828] bg-white border border-slate-300 rounded-lg px-2 py-0.5 font-bold shadow-xs">
                    {currentProfile.latency_budget_ms} ms
                  </span>
                </div>
                <input
                  type="range"
                  min="100"
                  max="800"
                  step="25"
                  value={currentProfile.latency_budget_ms}
                  onChange={(e) =>
                    onUpdateProfile(activeUseCase, {
                      ...currentProfile,
                      latency_budget_ms: parseInt(e.target.value, 10),
                    })
                  }
                  className="w-full h-2.5 bg-slate-300 hover:bg-slate-400/70 border border-slate-400 rounded-full cursor-pointer shadow-inner accent-[#4F46E5] transition-colors"
                />
              </div>
            </div>

            {/* Profile Overview Card */}
            <div className="glass-panel rounded-2xl p-6 text-xs space-y-2.5">
              <span className="text-[13px] text-[#101828] font-semibold block">
                Profile Architecture Summary
              </span>
              <p className="leading-relaxed text-[#667085] font-sans">{currentProfile.description}</p>
              <div className="pt-2.5 border-t border-slate-200 text-[11px] text-[#667085]">
                Git config sync: <code className="font-mono text-[#4F46E5] font-medium">policy/{currentProfile.use_case}.yaml</code>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* YAML Config Editor View */
        <div className="glass-panel rounded-2xl overflow-hidden">
          <div className="bg-slate-100/70 px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3 backdrop-blur-md">
            <div className="flex items-center space-x-2 font-mono text-xs text-[#475467] font-semibold">
              <FileCode className="h-4 w-4 text-[#4F46E5]" />
              <span>policy/{currentProfile.use_case}.yaml</span>
            </div>
            <button
              onClick={handleCopyYaml}
              className={`flex items-center space-x-1.5 px-4 py-1.5 rounded-xl border text-xs font-medium transition-all cursor-pointer shadow-xs ${
                copied
                  ? 'bg-[#ECFDF3] text-[#067647] border-[#ABEFC6]'
                  : 'glass-btn-secondary text-[#475467] hover:text-[#101828]'
              }`}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? 'Copied YAML!' : 'Copy YAML'}</span>
            </button>
          </div>
          <pre className="p-6 font-mono text-xs text-[#344054] glass-inset overflow-x-auto leading-relaxed m-6 rounded-xl">
            {policyToYaml(currentProfile)}
          </pre>
        </div>
      )}
    </div>
  );
};
