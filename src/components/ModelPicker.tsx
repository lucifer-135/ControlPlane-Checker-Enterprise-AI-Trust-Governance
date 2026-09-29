/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, CornerDownLeft, Search } from 'lucide-react';
import {
  MODEL_GROUP_LABELS,
  PROVIDER_LABELS,
  upstreamProviderFor,
  type ModelChoice,
} from '../lib/modelCatalog';

interface ModelPickerProps {
  id?: string;
  label?: string;
  value: string;
  onChange: (model: string) => void;
  choices: ModelChoice[];
  /** Marked "Default" in the list. */
  defaultModel?: string;
}

/** Search box + list (max-h-64) + footer, in px. */
const MENU_HEIGHT = 340;

const Tag: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="px-1.5 py-px rounded-md text-[10px] font-semibold border bg-slate-100 text-[#475467] border-slate-200 font-sans">
    {children}
  </span>
);

/**
 * Searchable model picker in the GlassDropdown style. Offers the gateway's chat models
 * and also accepts any model id typed in, which the gateway routes by name.
 */
export const ModelPicker: React.FC<ModelPickerProps> = ({
  id,
  label,
  value,
  onChange,
  choices,
  defaultModel,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [upwards, setUpwards] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  const q = query.trim();
  const filtered = useMemo(
    () => (q ? choices.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())) : choices),
    [choices, q],
  );
  // A typed id that isn't listed can still be sent as is; offered after the matches,
  // so Enter on a search fragment picks the first match
  const custom = q && !choices.some((c) => c.id === q || c.label === q) ? q : null;
  const items = [...filtered.map((c) => c.id), ...(custom ? [custom] : [])];
  const customIndex = filtered.length;
  const showProviders = new Set(choices.map((c) => c.provider)).size > 1;
  const selected = choices.find((c) => c.id === value);

  const openList = () => {
    const trigger = triggerRef.current;
    if (trigger) {
      // Room inside the nearest clipping ancestors (the playground scrolls), not the window
      const rect = trigger.getBoundingClientRect();
      let top = 0;
      let bottom = window.innerHeight;
      for (let el = trigger.parentElement; el; el = el.parentElement) {
        if (getComputedStyle(el).overflowY !== 'visible') {
          const box = el.getBoundingClientRect();
          top = Math.max(top, box.top);
          bottom = Math.min(bottom, box.bottom);
        }
      }
      const spaceBelow = bottom - rect.bottom;
      setUpwards(spaceBelow < MENU_HEIGHT && rect.top - top > spaceBelow);
    }
    setQuery('');
    setActive(
      Math.max(
        0,
        choices.findIndex((c) => c.id === value),
      ),
    );
    setOpen(true);
  };

  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const choose = (model: string) => {
    onChange(model);
    close(true);
  };

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((i) => Math.min(i + 1, items.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(Math.max(0, items.length - 1));
        break;
      case 'Enter':
        if (e.ctrlKey || e.metaKey) return; // Ctrl+Enter sends the request
        e.preventDefault();
        if (items[active]) choose(items[active]);
        break;
      case 'Escape':
        e.preventDefault(); // closes the list, not the playground
        close(true);
        break;
      case 'Tab':
        close();
        break;
    }
  };

  const valueProvider = PROVIDER_LABELS[upstreamProviderFor(value)];

  return (
    <div ref={containerRef} className={`relative w-full ${open ? 'z-50' : 'z-auto'}`}>
      {label && (
        <label
          htmlFor={id}
          className="text-[13px] text-[#344054] font-medium block mb-1.5 select-none"
        >
          {label}
        </label>
      )}

      <button
        ref={triggerRef}
        id={id}
        type="button"
        onClick={() => (open ? close() : openList())}
        onKeyDown={(e) => {
          if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
            e.preventDefault();
            openList();
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs rounded-xl min-h-[32px] text-left border transition-all duration-150 cursor-pointer select-none ${
          open
            ? 'bg-white border-[#4F46E5] ring-3 ring-[#4F46E5]/15 shadow-sm'
            : 'bg-white/85 hover:bg-white border-slate-200/90 hover:border-slate-300 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9),0_1px_2px_rgba(15,23,42,0.05)] hover:shadow-xs'
        }`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span
            className={`font-mono font-medium truncate ${value ? 'text-[#101828]' : 'text-[#98A2B3]'}`}
          >
            {selected?.label ?? (value || 'Choose a model')}
          </span>
          {value && value === defaultModel && <Tag>Default</Tag>}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {value && <span className="text-[10px] font-medium text-[#667085]">{valueProvider}</span>}
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-200 ${
              open ? 'rotate-180 text-[#4F46E5]' : 'text-[#98A2B3]'
            }`}
          />
        </span>
      </button>

      {open && (
        <div
          className={`absolute left-0 right-0 z-50 ${
            upwards ? 'bottom-full mb-1.5 origin-bottom' : 'top-full mt-1.5 origin-top'
          } bg-white/95 backdrop-blur-xl border border-slate-200/90 rounded-2xl shadow-[0_16px_36px_-6px_rgba(15,23,42,0.14),0_6px_16px_-4px_rgba(15,23,42,0.08),inset_0_1px_0_0_rgba(255,255,255,0.95)] animate-in fade-in-0 zoom-in-95 duration-150 overflow-hidden`}
        >
          <div className="p-2 border-b border-slate-100">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-50/80 border border-slate-200 focus-within:border-[#4F46E5] focus-within:bg-white transition-colors">
              <Search className="h-3.5 w-3.5 text-[#98A2B3] shrink-0" />
              <input
                ref={inputRef}
                role="combobox"
                aria-controls={listboxId}
                aria-expanded="true"
                aria-autocomplete="list"
                aria-activedescendant={items[active] !== undefined ? optionId(active) : undefined}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onSearchKeyDown}
                placeholder="Search, or type any model id"
                spellCheck={false}
                autoComplete="off"
                className="flex-1 min-w-0 bg-transparent text-xs font-mono text-[#101828] placeholder:font-sans placeholder:text-[#98A2B3] outline-none"
              />
              <span className="text-[10px] text-[#98A2B3] tnum shrink-0">
                {filtered.length}
                {q ? ` of ${choices.length}` : ''}
              </span>
            </div>
          </div>

          <ul id={listboxId} role="listbox" className="max-h-64 overflow-y-auto p-1 scrollbar-thin">
            {filtered.map((c, index) => {
              const isSelected = c.id === value;
              const isActive = index === active;
              const header = index === 0 || filtered[index - 1].group !== c.group;
              return (
                <React.Fragment key={c.id}>
                  {header && (
                    <li
                      role="presentation"
                      className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#98A2B3] select-none"
                    >
                      {MODEL_GROUP_LABELS[c.group]}
                    </li>
                  )}
                  <li
                    id={optionId(index)}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActive(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(c.id)}
                    className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-[#EEF0FE] text-[#4F46E5] font-semibold'
                        : isActive
                          ? 'bg-slate-100/80 text-[#101828]'
                          : 'text-[#344054]'
                    }`}
                  >
                    <span className="font-mono truncate">{c.label}</span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {c.id === defaultModel && <Tag>Default</Tag>}
                      {showProviders && <Tag>{PROVIDER_LABELS[c.provider]}</Tag>}
                      {isSelected && <Check className="h-3.5 w-3.5" />}
                    </span>
                  </li>
                </React.Fragment>
              );
            })}

            {custom && (
              <>
                <li
                  role="presentation"
                  className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#98A2B3] select-none"
                >
                  Any model id
                </li>
                <li
                  id={optionId(customIndex)}
                  role="option"
                  aria-selected={custom === value}
                  onMouseEnter={() => setActive(customIndex)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(custom)}
                  className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                    active === customIndex ? 'bg-slate-100/80 text-[#101828]' : 'text-[#344054]'
                  }`}
                >
                  <span className="min-w-0 truncate">
                    Use <span className="font-mono font-medium">{custom}</span>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0 text-[10px] text-[#667085]">
                    routes to {PROVIDER_LABELS[upstreamProviderFor(custom)]}
                    <CornerDownLeft className="h-3 w-3" />
                  </span>
                </li>
              </>
            )}

            {items.length === 0 && (
              <li className="px-3 py-6 text-center text-[11px] text-[#98A2B3]">
                Model list unavailable. Type a model id above.
              </li>
            )}
          </ul>

          <div className="px-3 py-1.5 border-t border-slate-100 text-[10px] text-[#98A2B3] leading-snug">
            Chat models from <span className="font-mono">GET /v1/models</span>. Speech, image, video
            and embedding models are hidden.
          </div>
        </div>
      )}
    </div>
  );
};
