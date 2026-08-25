/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { VerdictTier } from '../types';
import { CheckCircle2, Info, AlertTriangle, ShieldX } from 'lucide-react';

interface VerdictBadgeProps {
  verdict: VerdictTier;
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
}

export const VerdictBadge: React.FC<VerdictBadgeProps> = ({
  verdict,
  size = 'md',
  showIcon = true,
}) => {
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-[10px]',
    md: 'px-2.5 py-1 text-xs',
    lg: 'px-3.5 py-1.5 text-sm',
  };

  const iconSizes = {
    sm: 'h-3 w-3 mr-1',
    md: 'h-3.5 w-3.5 mr-1.5',
    lg: 'h-4 w-4 mr-2',
  };

  const base = `inline-flex items-center rounded-lg font-medium border backdrop-blur-md backdrop-saturate-150 transition-all ${sizeClasses[size]}`;

  switch (verdict) {
    case 'ALLOW':
      return (
        <span className={`${base} bg-[#ECFDF3]/80 text-[#067647] border-[#ABEFC6] shadow-[0_1px_2px_rgba(6,118,71,0.06),inset_0_1px_0_rgba(255,255,255,0.9)]`}>
          {showIcon && <CheckCircle2 className={iconSizes[size]} />}
          <span>Allow</span>
        </span>
      );

    case 'BADGE':
      return (
        <span className={`${base} bg-[#EFF6FF]/80 text-[#175CD3] border-[#B2DDFF] shadow-[0_1px_2px_rgba(23,92,211,0.06),inset_0_1px_0_rgba(255,255,255,0.9)]`}>
          {showIcon && <Info className={iconSizes[size]} />}
          <span>Badge</span>
        </span>
      );

    case 'SOFT_CORRECT':
      return (
        <span className={`${base} bg-[#FFFAEB]/85 text-[#B54708] border-[#FEDF89] shadow-[0_1px_2px_rgba(181,71,8,0.06),inset_0_1px_0_rgba(255,255,255,0.9)]`}>
          {showIcon && <AlertTriangle className={iconSizes[size]} />}
          <span>Soft-Correct</span>
        </span>
      );

    case 'BLOCK_ESCALATE':
      return (
        <span className={`${base} bg-[#FEF3F2]/85 text-[#B42318] border-[#FECDCA] font-semibold shadow-[0_1px_2px_rgba(180,35,24,0.08),inset_0_1px_0_rgba(255,255,255,0.9)]`}>
          {showIcon && <ShieldX className={iconSizes[size]} />}
          <span>Block + Escalate</span>
        </span>
      );

    default:
      return (
        <span className={`${base} bg-[#F1F3F6]/80 text-[#475467] border-[#E4E7EC]`}>
          {verdict}
        </span>
      );
  }
};
