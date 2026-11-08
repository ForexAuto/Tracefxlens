'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  resolveTopDownTimeframePair,
  TIMEFRAME_RANK,
  TIMEFRAMES,
  TimeframeOption,
  TOP_DOWN_TIMEFRAME_PAIRS,
} from '@/lib/trading-data';

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

interface TopDownTimeframeSelectorProps {
  value: string;
  onChange: (pairId: string) => void;
  disabled?: boolean;
}

const MACRO_HTF_OPTIONS = [...TIMEFRAMES]
  .filter((tf) => (TIMEFRAME_RANK[tf.value] ?? 0) > 1)
  .reverse();

export function TopDownTimeframeSelector({
  value,
  onChange,
  disabled,
}: TopDownTimeframeSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedPair = resolveTopDownTimeframePair(value);
  const [customMacro, setCustomMacro] = useState<string>(selectedPair.macroTf);
  const [customExec, setCustomExec] = useState<string>(
    selectedPair.executionTf
  );

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

  const handleToggleOpen = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        setCustomMacro(selectedPair.macroTf);
        setCustomExec(selectedPair.executionTf);
      }
      return next;
    });
  };

  const handleSelectPreset = (pairId: string) => {
    onChange(pairId);
    setOpen(false);
  };

  const validExecOptions = TIMEFRAMES.filter(
    (tf) =>
      (TIMEFRAME_RANK[tf.value] ?? 0) < (TIMEFRAME_RANK[customMacro] ?? 0)
  ).reverse();

  const handleMacroSelectChange = (nextMacro: string) => {
    setCustomMacro(nextMacro);
    const nextMacroRank = TIMEFRAME_RANK[nextMacro] ?? 5;
    const curExecRank = TIMEFRAME_RANK[customExec] ?? 2;
    if (curExecRank >= nextMacroRank) {
      const fallbackExec = [...TIMEFRAMES]
        .reverse()
        .find((tf) => (TIMEFRAME_RANK[tf.value] ?? 0) < nextMacroRank);
      if (fallbackExec) {
        setCustomExec(fallbackExec.value);
      }
    }
  };

  const handleApplyCustom = () => {
    const resolved = resolveTopDownTimeframePair(customMacro, customExec);
    onChange(resolved.id);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <label className="mb-1.5 block text-xs font-medium text-slate-400">
        Timeframe Pair
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={handleToggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex min-h-[50px] w-full items-center justify-between gap-2 rounded-xl border border-slate-800 bg-[#0D1320] px-3 py-2 text-left transition-colors duration-150 hover:border-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <div className="min-w-0">
          <div className="font-[family-name:var(--font-mono)] text-sm font-semibold tracking-tight text-slate-100 whitespace-nowrap tabular-nums">
            {selectedPair.label}
          </div>
          <p className="truncate text-[11px] text-slate-400">
            {selectedPair.style} · Tight Risk
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
              className="fixed inset-x-0 bottom-0 z-50 flex max-h-[82vh] flex-col rounded-t-3xl border-t border-slate-800 bg-[#111726] shadow-2xl lg:absolute lg:inset-x-auto lg:top-[calc(100%+8px)] lg:bottom-auto lg:right-0 lg:max-h-[480px] lg:w-[320px] lg:rounded-2xl lg:border"
            >
              <div className="mx-auto mt-3 h-1.5 w-10 rounded-full bg-slate-700 lg:hidden" />

              <div className="flex items-center justify-between px-4 pt-3 pb-2.5 lg:pt-3.5">
                <div>
                  <span className="text-sm font-semibold text-slate-100">
                    Top-Down CRT Fractal
                  </span>
                  <p className="text-[11px] text-slate-400">
                    Macro HTF dominates · Execution LTF refines
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close timeframe pair selector"
                  className="flex min-h-[44px] min-w-[44px] -mr-2 items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 lg:min-h-[32px] lg:min-w-[32px] lg:mr-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div
                role="listbox"
                aria-label="Top-Down CRT timeframe presets"
                className="overflow-y-auto border-t border-slate-800/80 px-2 py-1.5"
              >
                {TOP_DOWN_TIMEFRAME_PAIRS.map((pair) => {
                  const isSelected = pair.id === selectedPair.id;
                  return (
                    <button
                      key={pair.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleSelectPreset(pair.id)}
                      className={`flex min-h-[50px] w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-150 ${
                        isSelected
                          ? 'bg-sky-500/10 text-sky-100'
                          : 'text-slate-200 hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-[74px] shrink-0 font-[family-name:var(--font-mono)] text-xs sm:text-sm font-semibold tabular-nums whitespace-nowrap">
                          {pair.label}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium leading-tight">
                            {pair.style}
                          </div>
                          <div className="truncate text-xs text-slate-500">
                            {pair.detail}
                          </div>
                        </div>
                      </div>
                      {isSelected && (
                        <Check className="h-4 w-4 shrink-0 text-sky-400" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Custom HTF -> LTF Builder */}
              <div className="border-t border-slate-800/80 bg-[#0D1320]/70 px-3.5 pt-2.5 pb-6 lg:pb-3 lg:rounded-b-2xl">
                <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400">
                  <span className="font-medium text-slate-300">
                    Custom HTF → LTF Pair
                  </span>
                  <span>Macro &gt; Execution</span>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Macro higher timeframe"
                    value={customMacro}
                    onChange={(e) => handleMacroSelectChange(e.target.value)}
                    className="min-h-[40px] flex-1 rounded-lg border border-slate-800 bg-[#0D1320] px-2.5 py-1.5 font-[family-name:var(--font-mono)] text-xs font-semibold text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none"
                  >
                    {MACRO_HTF_OPTIONS.map((tf) => (
                      <option key={tf.value} value={tf.value}>
                        {tf.value} Macro
                      </option>
                    ))}
                  </select>
                  <span
                    className="font-[family-name:var(--font-mono)] text-xs text-slate-500"
                    aria-hidden="true"
                  >
                    →
                  </span>
                  <select
                    aria-label="Execution lower timeframe"
                    value={customExec}
                    onChange={(e) => setCustomExec(e.target.value)}
                    className="min-h-[40px] flex-1 rounded-lg border border-slate-800 bg-[#0D1320] px-2.5 py-1.5 font-[family-name:var(--font-mono)] text-xs font-semibold text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none"
                  >
                    {validExecOptions.map((tf) => (
                      <option key={tf.value} value={tf.value}>
                        {tf.value} Exec
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleApplyCustom}
                    className="min-h-[40px] shrink-0 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-sky-400 whitespace-nowrap"
                  >
                    Apply
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
