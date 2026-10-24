'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Search, Check, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { AssetCategory, MARKET_PAIRS, MarketPair } from '@/lib/trading-data';

interface PairSelectorProps {
  value: string;
  onChange: (symbol: string) => void;
  disabled?: boolean;
}

const CATEGORIES: Array<'All' | AssetCategory> = ['All', 'Forex', 'Commodities', 'Crypto'];

export function PairSelector({ value, onChange, disabled }: PairSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<'All' | AssetCategory>('All');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedPair: MarketPair = useMemo(() => {
    return (
      MARKET_PAIRS.find((p) => p.symbol === value) || {
        symbol: value,
        name: 'Custom Market Pair',
        category: 'Forex',
        decimals: 4,
      }
    );
  }, [value]);

  const filteredPairs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MARKET_PAIRS.filter((pair) => {
      const matchesCat = activeCategory === 'All' || pair.category === activeCategory;
      if (!matchesCat) return false;
      if (!q) return true;
      return (
        pair.symbol.toLowerCase().includes(q) ||
        pair.symbol.replace('/', '').toLowerCase().includes(q) ||
        pair.name.toLowerCase().includes(q)
      );
    });
  }, [query, activeCategory]);

  const closeMenu = () => {
    setOpen(false);
    setQuery('');
  };

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setQuery('');
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        window.innerWidth >= 1024 &&
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      if (window.innerWidth >= 1024) {
        searchInputRef.current?.focus();
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [open]);

  const handleSelect = (symbol: string) => {
    onChange(symbol);
    closeMenu();
  };

  const formattedCustomSymbol = query
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9/.-]/g, '');

  return (
    <div ref={containerRef} className="relative">
      <label className="mb-1.5 block text-xs font-medium text-slate-400">
        Market Pair
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (open) closeMenu();
          else setOpen(true);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex min-h-[50px] w-full items-center justify-between gap-2 rounded-xl border border-slate-800 bg-[#0D1320] px-3 py-2 text-left transition-colors duration-150 hover:border-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <div className="min-w-0">
          <div className="font-[family-name:var(--font-mono)] text-sm font-semibold tracking-tight text-slate-100 whitespace-nowrap truncate">
            {selectedPair.symbol}
          </div>
          <p className="truncate text-[11px] text-slate-400">
            {selectedPair.category} · {selectedPair.name}
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
              onClick={closeMenu}
              className="fixed inset-0 z-40 bg-black/65 backdrop-blur-xs lg:hidden"
            />

            {/* Bottom Sheet on Mobile, Anchored Popover on Desktop */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-x-0 bottom-0 z-50 flex max-h-[82vh] flex-col rounded-t-3xl border-t border-slate-800 bg-[#111726] shadow-2xl lg:absolute lg:inset-x-auto lg:top-[calc(100%+8px)] lg:bottom-auto lg:left-0 lg:max-h-[440px] lg:w-[380px] lg:rounded-2xl lg:border"
            >
              {/* Mobile Drag Handle */}
              <div className="mx-auto mt-3 h-1.5 w-10 rounded-full bg-slate-700 lg:hidden" />

              <div className="flex items-center justify-between px-4 pt-3 pb-2 lg:pt-3.5">
                <span className="text-sm font-semibold text-slate-100">
                  Select Market Instrument
                </span>
                <button
                  type="button"
                  onClick={closeMenu}
                  aria-label="Close market selector"
                  className="flex min-h-[44px] min-w-[44px] -mr-2 items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 lg:min-h-[32px] lg:min-w-[32px] lg:mr-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Search Bar */}
              <div className="px-4 pb-2.5">
                <div className="relative flex items-center">
                  <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-slate-500" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search EUR/USD, XAU/USD, BTC..."
                    className="min-h-[44px] w-full rounded-xl border border-slate-800 bg-[#090D16] pl-10 pr-9 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      aria-label="Clear search"
                      className="absolute right-1 flex min-h-[40px] min-w-[40px] items-center justify-center text-slate-400 hover:text-slate-200"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Interactive Category Filter Segmented Controls */}
              <div className="px-4 pb-3">
                <div className="grid grid-cols-4 gap-1 rounded-xl bg-[#090D16] p-1 border border-slate-800/80">
                  {CATEGORIES.map((cat) => {
                    const active = activeCategory === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setActiveCategory(cat)}
                        className={`min-h-[38px] rounded-lg px-2 text-xs font-medium transition-colors duration-150 whitespace-nowrap truncate ${
                          active
                            ? 'bg-slate-800 text-slate-100 shadow-xs'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Pair List */}
              <div
                role="listbox"
                className="flex-1 overflow-y-auto border-t border-slate-800/80 px-2 py-1.5 pb-6 lg:pb-2"
              >
                {filteredPairs.map((pair) => {
                  const isSelected = pair.symbol === value;
                  return (
                    <button
                      key={pair.symbol}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleSelect(pair.symbol)}
                      className={`flex min-h-[52px] w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-150 ${
                        isSelected
                          ? 'bg-sky-500/10 text-sky-100'
                          : 'text-slate-200 hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-[family-name:var(--font-mono)] text-sm font-semibold tabular-nums">
                            {pair.symbol}
                          </span>
                          <span className="text-slate-600" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-xs text-slate-400">
                            {pair.category}
                          </span>
                        </div>
                        <p className="truncate text-xs text-slate-500">{pair.name}</p>
                      </div>
                      {isSelected && (
                        <Check className="h-4 w-4 shrink-0 text-sky-400" />
                      )}
                    </button>
                  );
                })}

                {formattedCustomSymbol.length >= 3 &&
                  !MARKET_PAIRS.some((p) => p.symbol === formattedCustomSymbol) && (
                    <button
                      type="button"
                      onClick={() => handleSelect(formattedCustomSymbol)}
                      className="mt-1 flex min-h-[52px] w-full items-center justify-between rounded-xl border border-dashed border-slate-700 px-3 py-2 text-left text-sm text-sky-300 hover:bg-slate-800/50"
                    >
                      <div>
                        <span className="font-[family-name:var(--font-mono)] font-semibold">
                          Use &ldquo;{formattedCustomSymbol}&rdquo;
                        </span>
                        <p className="text-xs text-slate-400">
                          Analyze custom global ticker
                        </p>
                      </div>
                      <Check className="h-4 w-4 shrink-0 text-sky-400" />
                    </button>
                  )}

                {filteredPairs.length === 0 && formattedCustomSymbol.length < 3 && (
                  <div className="py-8 text-center text-sm text-slate-500">
                    No matching pairs found. Type any custom symbol to use it.
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
