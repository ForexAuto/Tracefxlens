'use client';

import React from 'react';
import Link from 'next/link';
import { WifiOff, History, ScanLine, RefreshCw } from 'lucide-react';
import { AppHeaderWithSidebar } from '@/components/navigation-sidebar';

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100 flex flex-col">
      <AppHeaderWithSidebar activeRoute="analyze" />

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-6 py-12 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400">
          <WifiOff className="h-5 w-5" />
        </div>

        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-white [text-wrap:balance]">
          You Are Currently Offline
        </h1>

        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Live AI chart scanning requires an internet connection, but all previously saved setups and marked charts in your local Signal History are available right now offline.
        </p>

        <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3 w-full">
          <Link
            href="/history"
            className="flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-sky-500 px-5 py-2.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 transition-colors whitespace-nowrap"
          >
            <History className="h-4 w-4" />
            <span>Open Saved Signal History</span>
          </Link>

          <Link
            href="/"
            className="flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-2 rounded-lg border border-slate-800 bg-[#111726] px-4 py-2.5 text-xs font-medium text-slate-200 hover:border-slate-700 hover:text-white transition-colors whitespace-nowrap"
          >
            <ScanLine className="h-4 w-4" />
            <span>Analyze Workspace</span>
          </Link>
        </div>

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-5 flex min-h-[44px] items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 whitespace-nowrap"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Retry Connection</span>
        </button>
      </main>
    </div>
  );
}
