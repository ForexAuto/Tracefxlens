'use client';

import React, { useEffect } from 'react';
import { Lock, Check, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { SignalHistoryRecord, TradeOutcome } from '@/lib/trading-data';

interface OutcomeLockDialogProps {
  open: boolean;
  record: SignalHistoryRecord | null;
  pendingOutcome: TradeOutcome | null;
  isSaving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function OutcomeLockDialog({
  open,
  record,
  pendingOutcome,
  isSaving,
  onConfirm,
  onCancel,
}: OutcomeLockDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSaving) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isSaving, onCancel]);

  const isWon = pendingOutcome === 'WON';

  return (
    <AnimatePresence>
      {open && record && pendingOutcome && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={() => !isSaving && onCancel()}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-3 sm:items-center sm:p-6 backdrop-blur-xs"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="outcome-lock-title"
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#111726] p-5 sm:p-6 shadow-2xl"
          >
            <div className="flex items-start gap-3.5">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                  isWon
                    ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-400'
                    : 'border-rose-500/35 bg-rose-500/12 text-rose-400'
                }`}
              >
                {isWon ? (
                  <Check className="h-5 w-5" />
                ) : (
                  <X className="h-5 w-5" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <h2
                  id="outcome-lock-title"
                  className="font-[family-name:var(--font-display)] text-lg font-bold tracking-tight text-white"
                >
                  Lock Trade Outcome as {pendingOutcome}?
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  Once confirmed, this record is permanently sealed as{' '}
                  <span
                    className={`font-semibold ${
                      isWon ? 'text-emerald-300' : 'text-rose-300'
                    }`}
                  >
                    {pendingOutcome}
                  </span>{' '}
                  in your database history and cannot be toggled or edited again.
                </p>
              </div>
            </div>

            {/* Trade Verification Strip */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800/90 bg-[#0B101B] px-3.5 py-2.5 text-xs">
              <div className="flex items-center gap-2 text-slate-300">
                <span className="font-[family-name:var(--font-mono)] font-semibold text-white tabular-nums">
                  {record.pair}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-[family-name:var(--font-mono)] tabular-nums">
                  {record.timeframe}
                </span>
                <span aria-hidden="true">·</span>
                <span
                  className={`font-semibold ${
                    record.signalType === 'BUY'
                      ? 'text-emerald-400'
                      : record.signalType === 'SELL'
                      ? 'text-rose-400'
                      : 'text-amber-400'
                  }`}
                >
                  {record.signalType}
                </span>
              </div>
              <span className="font-[family-name:var(--font-mono)] text-slate-400 tabular-nums">
                Entry {record.entryPrice}
              </span>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={isSaving}
                onClick={onCancel}
                className="flex min-h-[44px] items-center justify-center rounded-xl border border-slate-700/90 bg-[#0B101B] px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={onConfirm}
                className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-50 whitespace-nowrap ${
                  isWon
                    ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                    : 'bg-rose-500 text-white hover:bg-rose-400'
                }`}
              >
                <Lock className="h-3.5 w-3.5" />
                <span>
                  {isSaving ? 'Locking...' : `Confirm & Lock ${pendingOutcome}`}
                </span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
