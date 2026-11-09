'use client';

import React from 'react';
import { Sparkles } from 'lucide-react';

export interface AiProbabilityBadgeProps {
  probability: number | null | undefined;
  rationale?: string | null;
  compact?: boolean;
}

/** A clearly labeled, uncalibrated estimate; never displayed for HOLD signals. */
export function AiProbabilityBadge({
  probability,
  rationale,
  compact = false,
}: AiProbabilityBadgeProps) {
  if (
    typeof probability !== 'number' ||
    !Number.isInteger(probability) ||
    probability < 1 ||
    probability > 99
  ) {
    return null;
  }

  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/[0.08] font-[family-name:var(--font-mono)] text-amber-200 ${
        compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs'
      }`}
      title={
        rationale
          ? `AI estimate of reaching TP1 before stop loss, assuming entry is filled. Experimental and uncalibrated. ${rationale}`
          : 'AI estimate of reaching TP1 before stop loss, assuming entry is filled. Experimental and uncalibrated.'
      }
      aria-label={`Experimental AI estimate ${probability} percent; not calibrated`}
    >
      <Sparkles className="h-3 w-3 shrink-0 text-amber-300" aria-hidden="true" />
      <span className="font-semibold tabular-nums">{probability}%</span>
      <span className="font-sans text-amber-100/70">AI estimate</span>
    </span>
  );
}
