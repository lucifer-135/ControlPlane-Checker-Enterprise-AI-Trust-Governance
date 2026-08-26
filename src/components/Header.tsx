/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  LayoutDashboard,
  ShieldAlert,
  Activity,
  Sliders,
  BarChart3,
  FlaskConical,
} from 'lucide-react';

interface HeaderProps {
  activeTab: 'dashboard' | 'feed' | 'sandbox' | 'review' | 'policy' | 'metrics';
  setActiveTab: (tab: 'dashboard' | 'feed' | 'sandbox' | 'review' | 'policy' | 'metrics') => void;
  reviewQueueCount: number;
  onOpenTester: () => void;
  hasApiKey: boolean;
  activeProfileName?: string;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  reviewQueueCount,
  onOpenTester,
}) => {
  const navItems = [
    {
      id: 'dashboard' as const,
      label: 'Overview',
      icon: LayoutDashboard,
      testId: 'tab-dashboard',
    },
    {
      id: 'feed' as const,
      label: 'Live Stream',
      icon: Activity,
      testId: 'tab-live-feed',
      hasLivePulse: true,
    },
    {
      id: 'sandbox' as const,
      label: 'Sandbox Playground',
      icon: FlaskConical,
      testId: 'tab-sandbox',
    },
    {
      id: 'review' as const,
      label: 'Review Queue',
      icon: ShieldAlert,
      testId: 'tab-review-queue',
      badgeCount: reviewQueueCount,
    },
    {
      id: 'policy' as const,
      label: 'Policy Studio',
      icon: Sliders,
      testId: 'tab-policy-profiles',
    },
    {
      id: 'metrics' as const,
      label: 'Trust Metrics',
      icon: BarChart3,
      testId: 'tab-trust-metrics',
    },
  ];

  return (
    <nav className="glass-panel-strong text-[#101828] top-0 border-b border-white/60 sticky z-50 backdrop-blur-2xl">
      <div className="flex justify-between items-center w-full px-6 sm:px-8 max-w-[1440px] mx-auto py-3.5">
        {/* Brand */}
        <div
          onClick={() => setActiveTab('dashboard')}
          className="flex flex-col cursor-pointer group select-none hover:opacity-90 transition-opacity"
          role="button"
          tabIndex={0}
          title="ControlPlane Checker - Home"
        >
          <span className="text-[16px] font-bold font-headline text-[#101828] tracking-tight leading-none group-hover:text-[#4F46E5] transition-colors">
            ControlPlane Checker
          </span>
          <span className="text-[11px] font-medium tracking-tight text-[#667085] leading-tight mt-1">
            Enterprise Trust &amp; Governance
          </span>
        </div>

        {/* Navigation Links - Distinct Recessed Pill Tray */}
        <div className="hidden md:flex items-center gap-1.5 p-1 rounded-2xl bg-slate-200/60 border border-slate-300/70 shadow-[inset_0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(255,255,255,0.7)] backdrop-blur-md">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                id={item.testId}
                onClick={() => setActiveTab(item.id)}
                className={`group/nav relative text-[13px] font-medium flex items-center gap-2 transition-all duration-200 cursor-pointer select-none px-3.5 py-1.5 rounded-xl border ${
                  isActive
                    ? 'text-[#4338CA] bg-white shadow-[0_2px_8px_rgba(79,70,229,0.15),0_1px_2px_rgba(0,0,0,0.04)] border-white font-semibold'
                    : 'text-[#475467] hover:text-[#101828] hover:bg-white/85 hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:border-white/90 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] border-transparent'
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 transition-all duration-200 group-hover/nav:scale-110 ${
                    isActive ? 'text-[#4F46E5]' : 'text-[#667085] group-hover/nav:text-[#4F46E5]'
                  }`}
                />
                <span>{item.label}</span>

                {/* Live Pulse Indicator for Live Stream Tab */}
                {item.hasLivePulse && !isActive && (
                  <span className="relative flex h-1.5 w-1.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#12B76A] opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#12B76A]" />
                  </span>
                )}

                {/* Counter Badge for Review Queue */}
                {typeof item.badgeCount === 'number' && item.badgeCount > 0 && (
                  <span
                    className={`ml-0.5 px-1.5 py-0.5 text-[10px] font-mono leading-none rounded-md font-semibold tnum transition-transform duration-200 group-hover/nav:scale-105 ${
                      isActive
                        ? 'bg-[#B42318] text-white shadow-xs'
                        : 'bg-[#FEF3F2]/90 text-[#B42318] border border-[#FECDCA]'
                    }`}
                  >
                    {item.badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Trailing Action */}
        <div className="flex items-center gap-4">
          <button
            onClick={onOpenTester}
            className="glass-btn-primary group/sandbox text-white px-4 py-2 rounded-xl flex items-center gap-2 text-[13px] font-medium cursor-pointer transition-all duration-200 hover:shadow-[0_6px_20px_rgba(79,70,229,0.4)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
            title="Open Interactive Governance Sandbox Lab"
          >
            <FlaskConical className="h-3.5 w-3.5 transition-transform duration-200 group-hover/sandbox:rotate-12 group-hover/sandbox:scale-110" />
            <span>Sandbox Lab</span>
          </button>
        </div>
      </div>
    </nav>
  );
};
