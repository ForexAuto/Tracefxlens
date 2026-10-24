'use client';

import React, { useEffect } from 'react';
import { Trash2, Lock } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { SignalHistoryRecord } from '@/lib/trading-data';

interface DeleteHistoryDialogProps {
  open: boolean;
  record: SignalHistoryRecord | null;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteHistoryDialog({
  open,
  record,
  isDeleting,
  onConfirm,
  onCancel,
}: DeleteHistoryDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeleting) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isDeleting, onCancel]);

  const isLocked = record?.outcome === 'WON' || record?.outcome === 'LOST';

  return (
    <AnimatePresence>
      {open && record && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={() => !isDeleting && onCancel()}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-3 sm:items-center sm:p-6 backdrop-blur-xs"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-history-title"
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#111726] p-5 sm:p-6 shadow-2xl"
          >
            <div className="flex items-start gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-rose-500/35 bg-rose-500/12 text-rose-400">
                <Trash2 className="h-5 w-5" />
              </div>

              <div className="min-w-0 flex-1">
                <h2
                  id="delete-history-title"
                  className="font-[family-name:var(--font-display)] text-lg font-bold tracking-tight text-white"
                >
                  Delete Signal Record?
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  This single archived signal and its marked chart snapshot will be permanently removed from your history and database. This action cannot be undone.
                </p>
              </div>
            </div>

            {/* Single Record Verification Strip */}
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

              {isLocked ? (
                <span
                  className={`inline-flex items-center gap-1 font-semibold ${
                    record.outcome === 'WON' ? 'text-emerald-300' : 'text-rose-300'
                  }`}
                >
                  <Lock className="h-3 w-3" />
                  <span>{record.outcome}</span>
                </span>
              ) : (
                <span className="font-[family-name:var(--font-mono)] text-slate-400 tabular-nums">
                  Entry {record.entryPrice}
                </span>
              )}
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={isDeleting}
                onClick={onCancel}
                className="flex min-h-[44px] items-center justify-center rounded-xl border border-slate-700/90 bg-[#0B101B] px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={onConfirm}
                className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-rose-500 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-400 disabled:opacity-50 whitespace-nowrap"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{isDeleting ? 'Deleting...' : 'Delete Record'}</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
