/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, FileText, MessagesSquare, Settings2 } from 'lucide-react';
import type { SyntheticInteraction } from '../types';

/** Rough token estimate (≈4 characters per token). */
function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function formatTokens(n: number): string {
  return `~${n.toLocaleString()} tokens`;
}

interface CollapsibleProps {
  icon: React.ReactNode;
  title: string;
  meta: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const Collapsible: React.FC<CollapsibleProps> = ({
  icon,
  title,
  meta,
  defaultOpen = false,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="glass-inset rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left cursor-pointer"
      >
        <span className="flex items-center gap-2 text-[11px] text-[#667085] font-medium">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-[#98A2B3]" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-[#98A2B3]" />
          )}
          {icon}
          {title}
        </span>
        <span className="text-[10px] font-mono text-[#667085] tnum whitespace-nowrap">{meta}</span>
      </button>
      {open && <div className="px-4 pb-4 space-y-2">{children}</div>}
    </div>
  );
};

interface InteractionContextPanelProps {
  item: SyntheticInteraction;
  /** Label for the retrieved-context section. */
  contextLabel?: string;
}

/**
 * Left-hand inspection pane: everything the model received for this request —
 * system prompt, earlier conversation turns, the user's message, and the
 * retrieved context (individual chunks when available).
 */
export const InteractionContextPanel: React.FC<InteractionContextPanelProps> = ({
  item,
  contextLabel = 'Retrieved context (governance source)',
}) => {
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set());
  const chunks = item.context_chunks || [];
  const history = item.history || [];

  const toggleChunk = (idx: number) =>
    setExpandedChunks((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  const allExpanded = chunks.length > 0 && expandedChunks.size === chunks.length;

  return (
    <div className="space-y-4">
      {item.system_prompt && (
        <Collapsible
          icon={<Settings2 className="h-3.5 w-3.5 text-[#98A2B3]" />}
          title="System prompt"
          meta={formatTokens(approxTokens(item.system_prompt))}
        >
          <p className="text-xs text-[#344054] leading-relaxed bg-white/90 p-3 rounded-lg border border-slate-200 font-sans whitespace-pre-wrap">
            {item.system_prompt}
          </p>
        </Collapsible>
      )}

      {history.length > 0 && (
        <Collapsible
          icon={<MessagesSquare className="h-3.5 w-3.5 text-[#98A2B3]" />}
          title="Conversation history"
          meta={`${history.length} earlier ${history.length === 1 ? 'turn' : 'turns'}`}
        >
          {history.map((turn, idx) => (
            <div
              key={idx}
              className={`text-xs leading-relaxed p-3 rounded-lg border font-sans ${
                turn.role === 'user'
                  ? 'bg-white/90 border-slate-200 text-[#101828]'
                  : 'bg-[#F4F3FF]/70 border-[#D9D6FE] text-[#344054]'
              }`}
            >
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#667085] mb-1">
                {turn.role === 'user' ? 'User' : 'Assistant'}
              </span>
              {turn.content}
            </div>
          ))}
        </Collapsible>
      )}

      <div className="glass-inset rounded-xl p-4 space-y-2">
        <span className="text-[11px] text-[#667085] block font-medium">
          User prompt{history.length > 0 ? ` (turn ${item.turn_number})` : ''}
        </span>
        <p className="text-sm text-[#101828] font-sans leading-relaxed">{item.prompt}</p>
      </div>

      <div className="glass-inset rounded-xl p-4 space-y-2">
        <div className="flex justify-between items-center gap-2">
          <span className="text-[11px] text-[#667085] font-medium">{contextLabel}</span>
          <span className="text-[10px] px-2 py-0.5 rounded-lg bg-[#F4F3FF] border border-[#D9D6FE] text-[#6941C6] font-medium whitespace-nowrap">
            {chunks.length > 0
              ? `${chunks.length} chunks · ${formatTokens(approxTokens(item.retrieved_context || ''))}`
              : item.retrieved_context
                ? 'Vector RAG Context'
                : 'No Context / Unverified'}
          </span>
        </div>

        {chunks.length > 0 ? (
          <div className="space-y-1.5">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() =>
                  setExpandedChunks(allExpanded ? new Set() : new Set(chunks.map((_, i) => i)))
                }
                className="text-[10px] font-medium text-[#4F46E5] hover:underline cursor-pointer"
              >
                {allExpanded ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
            {chunks.map((chunk, idx) => {
              const open = expandedChunks.has(idx);
              return (
                <div key={idx} className="bg-white/90 rounded-lg border border-slate-200">
                  <button
                    type="button"
                    onClick={() => toggleChunk(idx)}
                    aria-expanded={open}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer"
                  >
                    {open ? (
                      <ChevronDown className="h-3 w-3 shrink-0 text-[#98A2B3]" />
                    ) : (
                      <ChevronRight className="h-3 w-3 shrink-0 text-[#98A2B3]" />
                    )}
                    <FileText className="h-3 w-3 shrink-0 text-[#98A2B3]" />
                    <span className="font-mono text-[10px] font-semibold text-[#344054] whitespace-nowrap">
                      {chunk.source_id}
                    </span>
                    <span className="text-[11px] text-[#475467] truncate flex-1">
                      {chunk.title}
                    </span>
                    {chunk.score !== undefined && (
                      <span
                        className="font-mono text-[10px] text-[#667085] tnum"
                        title="Retriever similarity score"
                      >
                        {chunk.score.toFixed(2)}
                      </span>
                    )}
                  </button>
                  {open && (
                    <p className="px-3 pb-3 text-xs text-[#344054] leading-relaxed italic font-sans">
                      {chunk.text}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-[#344054] leading-relaxed italic bg-white/90 p-3 rounded-lg border border-slate-200 font-sans">
            {item.retrieved_context ||
              '[No retrieval context attached. Evaluated against certainty heuristic.]'}
          </p>
        )}
      </div>
    </div>
  );
};
