'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { TIMEFRAMES, TimeframeOption } from '@/lib/trading-data';

interface TimeframeSelectorProps {
  value: string;
  onChange: (timeframe: string) => void;
  disabled?: boolean;
}

export function TimeframeSelector({
  value,
  onChange,
  disabled,
}: TimeframeSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedTf: TimeframeOption =
    TIMEFRAMES.find((t) => t.value === value) || TIMEFRAMES[4];

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        window.innerWidth >= 1024 &&
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const handleSelect = (tfValue: string) => {
    onChange(tfValue);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <label className="mb-1.5 block text-xs font-medium text-slate-400">
        Timeframe
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex min-h-[50px] w-full items-center justify-between gap-2 rounded-xl border border-slate-800 bg-[#0D1320] px-3 py-2 text-left transition-colors duration-150 hover:border-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <div className="min-w-0">
          <div className="font-[family-name:var(--font-mono)] text-sm font-semibold tracking-tight text-slate-100 whitespace-nowrap">
            {selectedTf.value}
          </div>
          <p className="truncate text-[11px] text-slate-400">
            {selectedTf.label} · {selectedTf.style}
          </p>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-150 ${
            open ? 'rotate-180 text-sky-400' : ''
          }`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* Mobile Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-black/65 backdrop-blur-xs lg:hidden"
            />

            {/* Bottom Sheet on Mobile, Popover Menu on Desktop */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-x-0 bottom-0 z-50 flex max-h-[75vh] flex-col rounded-t-3xl border-t border-slate-800 bg-[#111726] shadow-2xl lg:absolute lg:inset-x-auto lg:top-[calc(100%+8px)] lg:bottom-auto lg:right-0 lg:max-h-[420px] lg:w-[270px] lg:rounded-2xl lg:border"
            >
              <div className="mx-auto mt-3 h-1.5 w-10 rounded-full bg-slate-700 lg:hidden" />

              <div className="flex items-center justify-between px-4 pt-3 pb-2.5 lg:pt-3.5">
                <span className="text-sm font-semibold text-slate-100">
                  Chart Timeframe
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close timeframe selector"
                  className="flex min-h-[44px] min-w-[44px] -mr-2 items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 lg:min-h-[32px] lg:min-w-[32px] lg:mr-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div
                role="listbox"
                className="overflow-y-auto border-t border-slate-800/80 px-2 py-1.5 pb-6 lg:pb-2"
              >
                {TIMEFRAMES.map((tf) => {
                  const isSelected = tf.value === value;
                  return (
                    <button
                      key={tf.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleSelect(tf.value)}
                      className={`flex min-h-[50px] w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-150 ${
                        isSelected
                          ? 'bg-sky-500/10 text-sky-100'
                          : 'text-slate-200 hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-10 font-[family-name:var(--font-mono)] text-sm font-semibold tabular-nums">
                          {tf.value}
                        </span>
                        <div>
                          <div className="text-sm font-medium leading-tight">
                            {tf.label}
                          </div>
                          <div className="text-xs text-slate-500">{tf.style}</div>
                        </div>
                      </div>
                      {isSelected && (
                        <Check className="h-4 w-4 shrink-0 text-sky-400" />
                      )}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
