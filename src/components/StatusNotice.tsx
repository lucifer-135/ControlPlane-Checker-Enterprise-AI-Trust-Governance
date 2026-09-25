/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';

export interface Notice {
  state: 'idle' | 'saving' | 'saved' | 'error';
  message?: string;
}

interface StatusNoticeProps {
  notice: Notice;
  onDismiss: () => void;
}

/** Floating pill reporting policy save progress and persistence failures. */
export const StatusNotice: React.FC<StatusNoticeProps> = ({ notice, onDismiss }) => {
  if (notice.state === 'idle') return null;

  const styles = {
    saving: 'bg-[#EFF6FF]/95 text-[#175CD3] border-[#B2DDFF]',
    saved: 'bg-[#ECFDF3]/95 text-[#067647] border-[#ABEFC6]',
    error: 'bg-[#FEF3F2]/95 text-[#B42318] border-[#FECDCA]',
  }[notice.state];

  return (
    <div
      role={notice.state === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      className={`fixed bottom-6 right-6 z-50 max-w-sm flex items-start gap-2.5 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-md text-xs font-medium ${styles}`}
    >
      {notice.state === 'saving' && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
      {notice.state === 'saved' && <CheckCircle2 className="h-4 w-4 shrink-0" />}
      {notice.state === 'error' && <AlertTriangle className="h-4 w-4 shrink-0" />}
      <span className="leading-relaxed">{notice.message}</span>
      {notice.state === 'error' && (
        <button
          onClick={onDismiss}
          className="ml-1 shrink-0 opacity-70 hover:opacity-100 cursor-pointer"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};
