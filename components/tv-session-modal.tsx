'use client';

import React, { useState, useEffect } from 'react';
import { X, Eye, EyeOff, Loader2 } from 'lucide-react';
import type { TvConnectPayload } from '@/lib/tv-engine-types';

interface TvSessionModalProps {
  open: boolean;
  isConnecting: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onConnect: (payload: TvConnectPayload) => Promise<void>;
}

export function TvSessionModal({
  open,
  isConnecting,
  errorMessage,
  onClose,
  onConnect,
}: TvSessionModalProps) {
  const [mode, setMode] = useState<'cookies' | 'json' | 'guest'>('cookies');
  const [sessionId, setSessionId] = useState('');
  const [sessionIdSign, setSessionIdSign] = useState('');
  const [cookieJson, setCookieJson] = useState('');
  const [chartUrl, setChartUrl] = useState('');
  const [showSecrets, setShowSecrets] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isConnecting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [open, isConnecting, onClose]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isConnecting) return;
    await onConnect({
      mode,
      sessionId,
      sessionIdSign,
      cookieJson,
      chartUrl,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        onClick={() => {
          if (!isConnecting) onClose();
        }}
        className="fixed inset-0 bg-black/75 backdrop-blur-xs"
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tv-session-modal-title"
        className="relative z-10 w-full max-w-lg rounded-xl border border-slate-800 bg-[#0E1422] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-800/80 px-5 py-4">
          <h2
            id="tv-session-modal-title"
            className="font-[family-name:var(--font-display)] text-base font-semibold text-white"
          >
            Connect TradingView Session
          </h2>
          <button
            type="button"
            disabled={isConnecting}
            onClick={onClose}
            aria-label="Close session modal"
            className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800/60 hover:text-white disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Interactive Mode Tabs */}
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-[#090D16] p-1 border border-slate-800/80">
            <button
              type="button"
              onClick={() => setMode('cookies')}
              className={`min-h-[36px] rounded-md px-3 text-xs font-medium transition-colors whitespace-nowrap ${
                mode === 'cookies'
                  ? 'bg-[#162033] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Quick Cookies
            </button>
            <button
              type="button"
              onClick={() => setMode('json')}
              className={`min-h-[36px] rounded-md px-3 text-xs font-medium transition-colors whitespace-nowrap ${
                mode === 'json'
                  ? 'bg-[#162033] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Cookie JSON
            </button>
            <button
              type="button"
              onClick={() => setMode('guest')}
              className={`min-h-[36px] rounded-md px-3 text-xs font-medium transition-colors whitespace-nowrap ${
                mode === 'guest'
                  ? 'bg-[#162033] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Guest Chart
            </button>
          </div>

          {mode === 'cookies' && (
            <div className="space-y-3.5">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label
                    htmlFor="tv-sessionid"
                    className="text-xs font-medium text-slate-300"
                  >
                    TradingView <span className="font-[family-name:var(--font-mono)] text-sky-400">sessionid</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowSecrets((v) => !v)}
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 whitespace-nowrap"
                  >
                    {showSecrets ? (
                      <>
                        <EyeOff className="h-3.5 w-3.5" />
                        <span>Hide</span>
                      </>
                    ) : (
                      <>
                        <Eye className="h-3.5 w-3.5" />
                        <span>Show</span>
                      </>
                    )}
                  </button>
                </div>
                <input
                  id="tv-sessionid"
                  type={showSecrets ? 'text' : 'password'}
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  placeholder="Paste sessionid value..."
                  autoComplete="off"
                  required
                  className="w-full min-h-[42px] rounded-lg border border-slate-800 bg-[#090D16] px-3.5 text-sm font-[family-name:var(--font-mono)] text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="tv-sessionid-sign"
                  className="mb-1.5 block text-xs font-medium text-slate-300"
                >
                  TradingView <span className="font-[family-name:var(--font-mono)] text-sky-400">sessionid_sign</span>{' '}
                  <span className="text-slate-500 font-normal">(recommended)</span>
                </label>
                <input
                  id="tv-sessionid-sign"
                  type={showSecrets ? 'text' : 'password'}
                  value={sessionIdSign}
                  onChange={(e) => setSessionIdSign(e.target.value)}
                  placeholder="Paste sessionid_sign value..."
                  autoComplete="off"
                  className="w-full min-h-[42px] rounded-lg border border-slate-800 bg-[#090D16] px-3.5 text-sm font-[family-name:var(--font-mono)] text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div className="pt-1 text-xs leading-relaxed text-slate-400 space-y-1">
                <p className="font-medium text-slate-300">How to grab your session cookies:</p>
                <p>1. Open TradingView logged in on desktop Chrome/Edge and press F12.</p>
                <p>2. Open Application → Cookies → https://www.tradingview.com.</p>
                <p>3. Copy the Value of sessionid and sessionid_sign and paste above.</p>
              </div>
            </div>
          )}

          {mode === 'json' && (
            <div className="space-y-2">
              <label
                htmlFor="tv-cookie-json"
                className="block text-xs font-medium text-slate-300"
              >
                Cookie-Editor JSON or Raw Cookie Header
              </label>
              <textarea
                id="tv-cookie-json"
                rows={5}
                value={cookieJson}
                onChange={(e) => setCookieJson(e.target.value)}
                placeholder='[{"name":"sessionid","value":"...","domain":".tradingview.com"}]'
                required
                className="w-full rounded-lg border border-slate-800 bg-[#090D16] p-3 text-xs font-[family-name:var(--font-mono)] text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
              />
              <p className="text-xs text-slate-400">
                Export cookies as JSON from the Cookie-Editor browser extension while on tradingview.com and paste directly here.
              </p>
            </div>
          )}

          {mode === 'guest' && (
            <div className="py-2 text-xs leading-relaxed text-slate-300 space-y-1.5">
              <p>
                Launches a clean cloud Chromium session on TradingView Supercharts immediately without cookies.
              </p>
              <p className="text-slate-400">
                Public symbols, timeframes, built-in indicators, and chart drawing tools work right away. Connect cookies anytime to access private layouts, invite-only indicators, and paper trading.
              </p>
            </div>
          )}

          <div className="pt-1 border-t border-slate-800/80">
            <label
              htmlFor="tv-chart-url"
              className="mb-1.5 block text-xs font-medium text-slate-400"
            >
              Optional Starting Layout URL
            </label>
            <input
              id="tv-chart-url"
              type="url"
              value={chartUrl}
              onChange={(e) => setChartUrl(e.target.value)}
              placeholder="https://www.tradingview.com/chart/"
              className="w-full min-h-[40px] rounded-lg border border-slate-800 bg-[#090D16] px-3 text-xs font-[family-name:var(--font-mono)] text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
            />
          </div>

          {errorMessage && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">
              {errorMessage}
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              disabled={isConnecting}
              onClick={onClose}
              className="min-h-[40px] rounded-lg border border-slate-800 bg-[#111726] px-4 py-2 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white disabled:opacity-50 whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isConnecting}
              className="flex min-h-[40px] items-center justify-center gap-2 rounded-lg bg-sky-500 px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-60 whitespace-nowrap"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Launching Browser...</span>
                </>
              ) : mode === 'guest' ? (
                <span>Launch Guest Chart</span>
              ) : (
                <span>Connect Session</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
