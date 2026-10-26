'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Check, X, Cpu } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  DEFAULT_VISION_MODEL_ID,
  INITIAL_VISION_MODEL_CATALOG,
  type VisionModelOption,
} from '@/lib/vision-models';

interface VisionModelSelectorProps {
  value: string;
  onChange: (modelId: string) => void;
  models: VisionModelOption[];
  openRouterConfigured: boolean;
  disabled?: boolean;
}

export function VisionModelSelector({
  value,
  onChange,
  models,
  openRouterConfigured,
  disabled,
}: VisionModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const catalog = models.length > 0 ? models : INITIAL_VISION_MODEL_CATALOG;

  const selectedModel: VisionModelOption = useMemo(() => {
    return (
      catalog.find((m) => m.id === value) ||
      catalog.find((m) => m.id === DEFAULT_VISION_MODEL_ID) ||
      INITIAL_VISION_MODEL_CATALOG[0]
    );
  }, [catalog, value]);

  const geminiModels = useMemo(
    () => catalog.filter((m) => m.provider === 'gemini'),
    [catalog]
  );

  const openRouterModels = useMemo(
    () => catalog.filter((m) => m.provider === 'openrouter'),
    [catalog]
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

  const handleSelect = (modelId: string) => {
    onChange(modelId);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="block text-xs font-medium text-slate-400">
          Vision Engine
        </label>
        <span className="text-[11px] font-medium text-slate-500">
          {selectedModel.provider === 'openrouter'
            ? 'OpenRouter · Free Vision'
            : 'Google Gemini'}
        </span>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex min-h-[50px] w-full items-center justify-between gap-2.5 rounded-xl border border-slate-800 bg-[#0D1320] px-3.5 py-2 text-left transition-colors duration-150 hover:border-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
              selectedModel.provider === 'openrouter'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : 'border-sky-500/30 bg-sky-500/10 text-sky-400'
            }`}
          >
            <Cpu className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-xs font-semibold text-slate-100 sm:text-sm">
                {selectedModel.name}
              </span>
              <span
                className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                  selectedModel.provider === 'openrouter'
                    ? 'border-emerald-500/30 bg-emerald-500/12 text-emerald-300'
                    : 'border-sky-500/30 bg-sky-500/12 text-sky-300'
                }`}
              >
                {selectedModel.badge}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-slate-400">
              {selectedModel.subtitle}
            </p>
          </div>
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

            {/* Bottom Sheet on Mobile, Anchored Popover on Desktop */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-x-0 bottom-0 z-50 flex max-h-[82vh] flex-col rounded-t-3xl border-t border-slate-800 bg-[#111726] shadow-2xl lg:absolute lg:inset-x-0 lg:top-[calc(100%+8px)] lg:bottom-auto lg:max-h-[460px] lg:rounded-2xl lg:border"
            >
              <div className="mx-auto mt-3 h-1.5 w-10 rounded-full bg-slate-700 lg:hidden" />

              <div className="flex items-center justify-between px-4 pt-3 pb-2.5 lg:pt-3.5">
                <div>
                  <span className="text-sm font-semibold text-slate-100">
                    Select Vision Engine
                  </span>
                  <p className="text-[11px] text-slate-400">
                    Gemini 3.8 Flash &amp; OpenRouter Free Vision (:free)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close vision model selector"
                  className="flex min-h-[44px] min-w-[44px] -mr-2 items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 lg:min-h-[32px] lg:min-w-[32px] lg:mr-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div
                role="listbox"
                className="flex-1 overflow-y-auto border-t border-slate-800/80 px-2.5 py-2 pb-6 lg:pb-2.5 space-y-3"
              >
                {/* Google Gemini Section */}
                <div>
                  <div className="px-2 pb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                    Google Gemini
                  </div>
                  <div className="space-y-1">
                    {geminiModels.map((model) => {
                      const isSelected = model.id === selectedModel.id;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => handleSelect(model.id)}
                          className={`flex min-h-[52px] w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-150 ${
                            isSelected
                              ? 'bg-sky-500/12 text-sky-100'
                              : 'text-slate-200 hover:bg-slate-800/60'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-semibold">
                                {model.name}
                              </span>
                              <span className="shrink-0 rounded-md border border-sky-500/30 bg-sky-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">
                                {model.badge}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-xs text-slate-400">
                              {model.subtitle}
                            </p>
                          </div>
                          {isSelected && (
                            <Check className="h-4 w-4 shrink-0 text-sky-400" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* OpenRouter Free Vision Section */}
                <div>
                  <div className="flex items-center justify-between gap-2 px-2 pb-1">
                    <span className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                      OpenRouter · Free Vision Models
                    </span>
                    {!openRouterConfigured && (
                      <span className="text-[10px] text-amber-400/90">
                        Set OPENROUTER_API_KEY in Secrets
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    {openRouterModels.map((model) => {
                      const isSelected = model.id === selectedModel.id;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => handleSelect(model.id)}
                          className={`flex min-h-[52px] w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-150 ${
                            isSelected
                              ? 'bg-emerald-500/12 text-emerald-100'
                              : 'text-slate-200 hover:bg-slate-800/60'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-semibold">
                                {model.name}
                              </span>
                              <span className="shrink-0 rounded-md border border-emerald-500/30 bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                                {model.badge}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-xs text-slate-400">
                              {model.subtitle}
                            </p>
                          </div>
                          {isSelected && (
                            <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
