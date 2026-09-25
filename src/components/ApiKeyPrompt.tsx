/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { KeyRound, X } from 'lucide-react';

interface ApiKeyPromptProps {
  isOpen: boolean;
  hasStoredKey: boolean;
  onSubmit: (key: string) => void;
  onClose: () => void;
}

/**
 * Asks the operator for a ControlPlane API key when the server requires
 * authentication. The key is kept in sessionStorage for this tab only.
 */
export const ApiKeyPrompt: React.FC<ApiKeyPromptProps> = ({
  isOpen,
  hasStoredKey,
  onSubmit,
  onClose,
}) => {
  const [value, setValue] = useState('');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/30 backdrop-blur-sm px-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) {
            onSubmit(value);
            setValue('');
          }
        }}
        className="glass-panel-strong w-full max-w-md rounded-2xl p-6 space-y-4 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-xl bg-[#EFF6FF] border border-[#B2DDFF]">
              <KeyRound className="h-4 w-4 text-[#2E90FA]" />
            </div>
            <h2 className="font-headline text-base font-semibold text-[#101828]">
              {hasStoredKey ? 'API key rejected' : 'API key required'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#667085] hover:text-[#101828] cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-[#475467] leading-relaxed">
          This control plane requires authentication. Enter a ControlPlane API key with at least the{' '}
          <strong>viewer</strong> role (reviewers can record decisions; admins can edit policies).
          The key is stored only for this browser tab.
        </p>
        <input
          type="password"
          autoComplete="off"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="cp_live_…"
          className="w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2 font-mono text-xs text-[#101828] focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!value.trim()}
            className="glass-btn-primary text-white px-4 py-2 rounded-xl text-xs font-medium disabled:opacity-40 cursor-pointer"
          >
            Use this key
          </button>
        </div>
      </form>
    </div>
  );
};
