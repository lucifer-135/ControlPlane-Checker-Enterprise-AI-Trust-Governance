/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface DropdownOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  badge?: string;
  badgeColor?: string;
  icon?: React.ComponentType<{ className?: string }>;
}

export interface GlassDropdownProps<T extends string = string> {
  id?: string;
  label?: string;
  value: T;
  onChange: (value: T) => void;
  options: DropdownOption<T>[];
  placeholder?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
  align?: 'left' | 'right';
  menuMaxHeight?: string;
}

export function GlassDropdown<T extends string = string>({
  id,
  label,
  value,
  onChange,
  options,
  placeholder = 'Select an option...',
  className = '',
  size = 'md',
  fullWidth = false,
  icon: LeadingIcon,
  disabled = false,
  align = 'left',
  menuMaxHeight = 'max-h-72',
}: GlassDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Sync focused index with selected option when opening
  useEffect(() => {
    if (isOpen) {
      const idx = options.findIndex((opt) => opt.value === value);
      setFocusedIndex(idx >= 0 ? idx : 0);
    }
  }, [isOpen, options, value]);

  // Scroll active item into view
  useEffect(() => {
    if (isOpen && focusedIndex >= 0 && listboxRef.current) {
      const activeEl = listboxRef.current.children[focusedIndex] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [focusedIndex, isOpen]);

  const handleSelect = useCallback(
    (val: T) => {
      onChange(val);
      setIsOpen(false);
    },
    [onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
      case 'Tab':
        e.preventDefault();
        setIsOpen(false);
        break;
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < options.length) {
          handleSelect(options[focusedIndex].value);
        }
        break;
      case 'Home':
        e.preventDefault();
        setFocusedIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setFocusedIndex(options.length - 1);
        break;
    }
  };

  // Size styling tokens matching project design system
  const sizeStyles = {
    sm: {
      button: 'px-3 py-1.5 text-xs rounded-xl min-h-[32px] gap-2',
      icon: 'h-3.5 w-3.5',
      chevron: 'h-3.5 w-3.5',
      menu: 'p-1 text-xs',
      item: 'px-2.5 py-1.5 rounded-lg text-xs gap-2',
    },
    md: {
      button: 'px-3.5 py-2.5 text-xs rounded-xl min-h-[40px] gap-2.5',
      icon: 'h-4 w-4',
      chevron: 'h-4 w-4',
      menu: 'p-1.5 text-xs',
      item: 'px-3 py-2 rounded-xl text-xs gap-2.5',
    },
    lg: {
      button: 'px-4 py-3 text-sm rounded-2xl min-h-[46px] gap-3',
      icon: 'h-4.5 w-4.5',
      chevron: 'h-4.5 w-4.5',
      menu: 'p-2 text-sm',
      item: 'px-3.5 py-2.5 rounded-xl text-sm gap-3',
    },
  }[size];

  const CurrentOptionIcon = selectedOption?.icon;

  return (
    <div
      ref={containerRef}
      className={`relative inline-block ${fullWidth ? 'w-full' : ''} ${className}`}
    >
      {label && (
        <label
          htmlFor={id}
          className="text-[13px] text-[#344054] font-medium block mb-1.5 select-none"
        >
          {label}
        </label>
      )}

      {/* Trigger Button */}
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`w-full flex items-center justify-between text-left font-sans transition-all duration-150 select-none cursor-pointer border ${
          sizeStyles.button
        } ${
          disabled
            ? 'opacity-50 cursor-not-allowed bg-slate-100/70 border-slate-200 text-[#98A2B3]'
            : isOpen
              ? 'bg-white border-[#4F46E5] ring-3 ring-[#4F46E5]/15 text-[#101828] shadow-sm'
              : 'bg-white/85 hover:bg-white border-slate-200/90 hover:border-slate-300 text-[#101828] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9),0_1px_2px_rgba(15,23,42,0.05)] hover:shadow-xs'
        }`}
      >
        <span className="flex items-center gap-2 truncate flex-1 min-w-0">
          {LeadingIcon && (
            <LeadingIcon
              className={`${sizeStyles.icon} text-[#4F46E5] shrink-0 transition-colors`}
            />
          )}
          {CurrentOptionIcon && !LeadingIcon && (
            <CurrentOptionIcon
              className={`${sizeStyles.icon} text-[#4F46E5] shrink-0 transition-colors`}
            />
          )}

          <span className="truncate font-medium">
            {selectedOption ? selectedOption.label : placeholder}
          </span>

          {selectedOption?.badge && (
            <span
              className={`ml-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold border ${
                selectedOption.badgeColor || 'bg-slate-100 text-[#475467] border-slate-200'
              }`}
            >
              {selectedOption.badge}
            </span>
          )}
        </span>

        <span className="ml-2 shrink-0 flex items-center text-[#98A2B3]">
          <ChevronDown
            className={`${sizeStyles.chevron} transition-transform duration-200 ease-out ${
              isOpen ? 'rotate-180 text-[#4F46E5]' : 'group-hover:text-[#475467]'
            }`}
          />
        </span>
      </button>

      {/* Floating Glassmorphic Dropdown Menu */}
      {isOpen && (
        <div
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} z-50 mt-1.5 w-full min-w-[220px] max-w-[420px] bg-white/95 backdrop-blur-xl border border-slate-200/90 rounded-2xl shadow-[0_16px_36px_-6px_rgba(15,23,42,0.14),0_6px_16px_-4px_rgba(15,23,42,0.08),inset_0_1px_0_0_rgba(255,255,255,0.95)] animate-in fade-in-0 zoom-in-95 duration-150 overflow-hidden`}
        >
          <ul
            ref={listboxRef}
            role="listbox"
            tabIndex={-1}
            className={`overflow-y-auto ${menuMaxHeight} ${sizeStyles.menu} space-y-0.5 scrollbar-thin`}
          >
            {options.map((option, index) => {
              const isSelected = option.value === value;
              const isFocused = index === focusedIndex;
              const OptionIcon = option.icon;

              return (
                <li
                  key={option.value}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setFocusedIndex(index)}
                  onClick={() => handleSelect(option.value)}
                  className={`flex items-start justify-between cursor-pointer transition-all duration-150 select-none ${
                    sizeStyles.item
                  } ${
                    isSelected
                      ? 'bg-[#EEF0FE] text-[#4F46E5] font-semibold shadow-xs'
                      : isFocused
                        ? 'bg-slate-100/80 text-[#101828]'
                        : 'text-[#344054] hover:bg-slate-100/60 hover:text-[#101828]'
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    {OptionIcon && (
                      <OptionIcon
                        className={`${sizeStyles.icon} mt-0.5 shrink-0 ${
                          isSelected ? 'text-[#4F46E5]' : 'text-[#667085]'
                        }`}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="truncate">{option.label}</span>
                        {option.badge && (
                          <span
                            className={`px-1.5 py-0.2 rounded-md text-[10px] font-semibold border ${
                              option.badgeColor || 'bg-slate-100 text-[#475467] border-slate-200'
                            }`}
                          >
                            {option.badge}
                          </span>
                        )}
                      </div>
                      {option.description && (
                        <p
                          className={`text-[11px] leading-relaxed mt-0.5 font-normal ${
                            isSelected ? 'text-[#4338CA]/80' : 'text-[#667085]'
                          }`}
                        >
                          {option.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <span className="ml-2 mt-0.5 shrink-0 text-[#4F46E5]">
                      <Check className="h-4 w-4" />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
