'use client';

import React, { useEffect } from 'react';
import { Square, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

interface StopConfirmDialogProps {
  open: boolean;
  selectedPair: string;
  selectedTimeframe: string;
  progressPct: number;
  onConfirmStop: () => void;
  onCancel: () => void;
}

export function StopConfirmDialog({
  open,
  selectedPair,
  selectedTimeframe,
  progressPct,
  onConfirmStop,
  onCancel,
}: StopConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onCancel}
            className="fixed inset-0 bg-black/70 backdrop-blur-xs"
          />

          {/* Mobile Bottom Sheet / Desktop Centered Confirmation Modal */}
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="stop-scan-dialog-title"
            aria-describedby="stop-scan-dialog-desc"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full rounded-t-3xl border-t border-slate-800 bg-[#111726] p-5 pb-7 shadow-2xl sm:max-w-md sm:rounded-2xl sm:border sm:p-6"
          >
            {/* Mobile Drag Handle */}
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-700 sm:hidden" />

            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-rose-500/35 bg-rose-500/12 text-rose-400">
                  <Square className="h-4 w-4 fill-current" />
                </div>
                <div>
                  <h2
                    id="stop-scan-dialog-title"
                    className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight text-white"
                  >
                    Stop Active Analysis?
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-400">
                    <span className="font-[family-name:var(--font-mono)] font-medium text-slate-300 tabular-nums">
                      {selectedPair} · {selectedTimeframe}
                    </span>{' '}
                    ·{' '}
                    <span className="font-[family-name:var(--font-mono)] text-sky-400 tabular-nums">
                      {progressPct}% verified
                    </span>
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onCancel}
                aria-label="Keep analyzing"
                className="flex min-h-[40px] min-w-[40px] -mt-1 -mr-1 items-center justify-center rounded-lg text-slate-400 transition-colors hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p
              id="stop-scan-dialog-desc"
              className="mt-3.5 text-sm leading-relaxed text-slate-300"
            >
              Stopping now will terminate the live model stream before final entry, stop-loss, and take-profit coordinates are generated.
            </p>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="flex min-h-[48px] items-center justify-center rounded-xl border border-slate-700/90 bg-[#0D1320] px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-100 transition-colors hover:border-slate-600 hover:bg-slate-800/70 whitespace-nowrap"
              >
                Keep Analyzing
              </button>
              <button
                type="button"
                onClick={onConfirmStop}
                className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl bg-rose-500 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white transition-colors hover:bg-rose-600 whitespace-nowrap"
              >
                <Square className="h-3 w-3 fill-current" />
                <span>Stop Analysis</span>
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
