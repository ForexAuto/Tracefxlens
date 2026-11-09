'use client';

import React, { useEffect } from 'react';
import { X, AlertTriangle, AlertCircle, Info, Loader2 } from 'lucide-react';

export type DialogVariant = 'danger' | 'warning' | 'primary';

interface TvConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: DialogVariant;
  icon?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function TvConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  icon,
  onConfirm,
  onCancel,
  isLoading = false,
}: TvConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel, isLoading]);

  if (!open) return null;

  const variantStyles = {
    danger: {
      iconBg: 'border-rose-500/35 bg-rose-500/12 text-rose-400',
      confirmBtn:
        'bg-rose-500 text-white hover:bg-rose-600 focus-visible:ring-rose-500/50 shadow-sm',
      defaultIcon: <AlertTriangle className="h-4 w-4" />,
    },
    warning: {
      iconBg: 'border-amber-500/35 bg-amber-500/12 text-amber-400',
      confirmBtn:
        'bg-amber-500 text-slate-950 font-semibold hover:bg-amber-400 focus-visible:ring-amber-500/50 shadow-sm',
      defaultIcon: <AlertCircle className="h-4 w-4" />,
    },
    primary: {
      iconBg: 'border-sky-500/35 bg-sky-500/12 text-sky-400',
      confirmBtn:
        'bg-sky-500 text-slate-950 font-semibold hover:bg-sky-400 focus-visible:ring-sky-500/50 shadow-sm',
      defaultIcon: <Info className="h-4 w-4" />,
    },
  }[variant];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4">
      {/* Instant Backdrop (no animations or transitions) */}
      <div
        onClick={isLoading ? undefined : onCancel}
        className="fixed inset-0 bg-black/80 backdrop-blur-xs"
        aria-hidden="true"
      />

      {/* Instant Modal Card / Mobile Sheet */}
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="tv-confirm-dialog-title"
        aria-describedby="tv-confirm-dialog-desc"
        className="relative z-10 w-full rounded-t-3xl border-t border-slate-800 bg-[#111726] p-5 pb-7 shadow-2xl sm:max-w-md sm:rounded-2xl sm:border sm:p-6"
      >
        {/* Mobile Drag Handle */}
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-700 sm:hidden" />

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${variantStyles.iconBg}`}
            >
              {icon || variantStyles.defaultIcon}
            </div>
            <div>
              <h2
                id="tv-confirm-dialog-title"
                className="font-[family-name:var(--font-display)] text-base sm:text-lg font-semibold tracking-tight text-white [text-wrap:balance]"
              >
                {title}
              </h2>
              <p
                id="tv-confirm-dialog-desc"
                className="mt-1.5 text-xs sm:text-sm leading-relaxed text-slate-300"
              >
                {description}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            aria-label="Close dialog"
            className="flex min-h-[36px] min-w-[36px] -mt-1 -mr-1 items-center justify-center rounded-lg text-slate-400 transition-colors hover:text-slate-200 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="w-full sm:w-auto min-h-[42px] rounded-xl border border-slate-700/80 bg-[#0D1320] px-4 py-2 text-xs sm:text-sm font-semibold text-slate-200 transition-colors hover:border-slate-600 hover:bg-slate-800/70 whitespace-nowrap disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`w-full sm:w-auto min-h-[42px] flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap disabled:opacity-60 ${variantStyles.confirmBtn}`}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Processing...</span>
              </>
            ) : (
              <span>{confirmLabel}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
