/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Eye } from 'lucide-react';
import type { EvaluationResult } from '../types';
import { userVisibleResponse } from '../lib/deliveryTreatment';

interface UserVisibleResponsePanelProps {
  evaluation: EvaluationResult;
  originalResponse: string;
}

/** Shows [REDACTED_*] placeholders as chips so the redactions stand out. */
function renderRedactions(text: string) {
  return text.split(/(\[REDACTED_[A-Z_]+\])/g).map((part, idx) =>
    /^\[REDACTED_[A-Z_]+\]$/.test(part) ? (
      <span
        key={idx}
        className="px-1 py-0.5 mx-0.5 rounded-md bg-[#FFFAEB] text-[#B54708] border border-[#FEDF89] font-mono text-[10px] font-semibold"
      >
        {part}
      </span>
    ) : (
      <React.Fragment key={idx}>{part}</React.Fragment>
    ),
  );
}

/**
 * The response exactly as the end user receives it — the refusal when withheld,
 * otherwise the answer with PII redacted and any accuracy warning appended.
 */
export const UserVisibleResponsePanel: React.FC<UserVisibleResponsePanelProps> = ({
  evaluation,
  originalResponse,
}) => {
  const view = userVisibleResponse(evaluation, originalResponse);
  const status = view.withheld
    ? { label: 'Withheld', className: 'text-[#B42318] bg-[#FEF3F2] border-[#FECDCA]' }
    : view.changed
      ? {
          label: 'Delivered with changes',
          className: 'text-[#B54708] bg-[#FFFAEB] border-[#FEDF89]',
        }
      : { label: 'Delivered unchanged', className: 'text-[#067647] bg-[#ECFDF3] border-[#ABEFC6]' };

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <span className="text-[11px] text-[#667085] font-medium flex items-center gap-1.5">
          <Eye className="h-3.5 w-3.5 text-[#98A2B3]" />
          What the user sees
        </span>
        <span
          className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg border whitespace-nowrap ${status.className}`}
        >
          {status.label}
        </span>
      </div>
      <div className="bg-[#F9FAFB] border border-dashed border-slate-300 rounded-xl p-3.5 text-xs leading-relaxed text-[#101828] whitespace-pre-wrap">
        {view.withheld ? (
          <span className="italic text-[#475467]">{view.body}</span>
        ) : (
          renderRedactions(view.body)
        )}
        {view.disclaimer && (
          <div className="mt-2.5 pt-2 border-t border-slate-200 text-[11px] text-[#B54708]">
            {view.disclaimer}
          </div>
        )}
      </div>
    </div>
  );
};
