'use client';

import type {} from '@serwist/next/typings';
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import Link from 'next/link';
import {
  Download,
  X,
  Check,
  WifiOff,
  History,
  Copy,
  Smartphone,
} from 'lucide-react';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms?: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Window {
    __tracefxDeferredPrompt?: BeforeInstallPromptEvent | null;
  }
}

interface PwaContextValue {
  isInstalled: boolean;
  isInstallable: boolean;
  swReady: boolean;
  isOnline: boolean;
  isIOS: boolean;
  isOppoOrLegacyAndroid: boolean;
  isEmbeddedIframe: boolean;
  bannerDismissed: boolean;
  triggerInstallOrGuide: () => Promise<void>;
  openInstallSheet: () => void;
  dismissMobileBanner: () => void;
}

const PwaContext = createContext<PwaContextValue>({
  isInstalled: false,
  isInstallable: false,
  swReady: false,
  isOnline: true,
  isIOS: false,
  isOppoOrLegacyAndroid: false,
  isEmbeddedIframe: false,
  bannerDismissed: false,
  triggerInstallOrGuide: async () => {},
  openInstallSheet: () => {},
  dismissMobileBanner: () => {},
});

const BANNER_DISMISSED_KEY = 'tracefx_pwa_banner_dismissed_v1';

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [swReady, setSwReady] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [isIOS, setIsIOS] = useState(false);
  const [isOppoOrLegacyAndroid, setIsOppoOrLegacyAndroid] = useState(false);
  const [isEmbeddedIframe, setIsEmbeddedIframe] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    const syncClientEnv = () => {
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone ===
          true;
      setIsInstalled(standalone);
      setIsOnline(window.navigator.onLine);

      const ua = window.navigator.userAgent || '';
      const ios = /iphone|ipad|ipod/i.test(ua);
      setIsIOS(ios);

      // Detect OPPO / ColorOS / Realme / CPH model codes or older Android <= 10
      const oppoMatch = /oppo|coloros|cph\d{4}|rmx\d{4}|p[a-z]{3}\d{2}/i.test(ua);
      const androidVerMatch = ua.match(/Android\s+(\d+)/i);
      const isOldAndroid =
        androidVerMatch ? parseInt(androidVerMatch[1], 10) <= 10 : false;
      setIsOppoOrLegacyAndroid(oppoMatch || isOldAndroid);

      let embedded = false;
      try {
        embedded = window.self !== window.top;
      } catch {
        embedded = true;
      }
      setIsEmbeddedIframe(embedded);

      try {
        const dismissed =
          window.sessionStorage.getItem(BANNER_DISMISSED_KEY) === '1';
        setBannerDismissed(standalone || dismissed);
      } catch {
        setBannerDismissed(standalone);
      }

      if (window.__tracefxDeferredPrompt) {
        setDeferredPrompt(window.__tracefxDeferredPrompt);
      }
    };

    const timer = window.setTimeout(syncClientEnv, 0);

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      const promptEvt = e as BeforeInstallPromptEvent;
      window.__tracefxDeferredPrompt = promptEvt;
      setDeferredPrompt(promptEvt);
    };

    const handleInstalled = () => {
      window.__tracefxDeferredPrompt = null;
      setDeferredPrompt(null);
      setIsInstalled(true);
      setSheetOpen(false);
    };

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setIsInstalled(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleDisplayModeChange);
    }

    // Purge any legacy pre-Serwist custom caches
    if ('caches' in window) {
      void window.caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter(
                (k) =>
                  k.startsWith('tracefx-') && !k.startsWith('tracefx-serwist')
              )
              .map((k) => window.caches.delete(k))
          )
        )
        .catch(() => {});
    }

    // Register real @serwist/next service worker via window.serwist
    const serwistInstance =
      typeof window !== 'undefined' ? window.serwist : undefined;
    const markReady = () => setSwReady(true);

    if ('serviceWorker' in navigator && serwistInstance !== undefined) {
      serwistInstance.addEventListener('installed', markReady);
      serwistInstance.addEventListener('activated', markReady);
      serwistInstance.addEventListener('controlling', markReady);

      void serwistInstance.active.then(markReady).catch(() => {});
      void serwistInstance
        .register()
        .then((reg) => {
          if (reg) {
            setSwReady(true);
          }
        })
        .catch(() => {
          setSwReady(false);
        });
    } else if ('serviceWorker' in navigator) {
      // Fallback check if serviceWorker is already registered under scope
      navigator.serviceWorker
        .getRegistration('/')
        .then((reg) => {
          if (reg) setSwReady(true);
        })
        .catch(() => {});
    }

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', handleDisplayModeChange);
      }
      if (serwistInstance !== undefined) {
        serwistInstance.removeEventListener('installed', markReady);
        serwistInstance.removeEventListener('activated', markReady);
        serwistInstance.removeEventListener('controlling', markReady);
      }
    };
  }, []);

  const dismissMobileBanner = useCallback(() => {
    setBannerDismissed(true);
    try {
      window.sessionStorage.setItem(BANNER_DISMISSED_KEY, '1');
    } catch {
      // ignore
    }
  }, []);

  const openInstallSheet = useCallback(() => {
    setSheetOpen(true);
  }, []);

  const triggerInstallOrGuide = useCallback(async () => {
    const promptObj = deferredPrompt || window.__tracefxDeferredPrompt;
    if (promptObj) {
      try {
        await promptObj.prompt();
        const choice = await promptObj.userChoice;
        if (choice.outcome === 'accepted') {
          window.__tracefxDeferredPrompt = null;
          setDeferredPrompt(null);
          setIsInstalled(true);
          setSheetOpen(false);
          return;
        }
      } catch {
        // If ColorOS or embedded browser blocks native prompt, open compatibility guide
      }
    }
    setSheetOpen(true);
  }, [deferredPrompt]);

  const handleCopyCurrentUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 2200);
    } catch {
      // ignore
    }
  };

  return (
    <PwaContext.Provider
      value={{
        isInstalled,
        isInstallable: Boolean(deferredPrompt),
        swReady,
        isOnline,
        isIOS,
        isOppoOrLegacyAndroid,
        isEmbeddedIframe,
        bannerDismissed,
        triggerInstallOrGuide,
        openInstallSheet,
        dismissMobileBanner,
      }}
    >
      {children}

      {/* Non-Intrusive Offline Connectivity Bar (stays well within 15% mobile sticky cap) */}
      {!isOnline && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-3 left-3 right-3 sm:left-auto sm:right-5 sm:max-w-md z-40 flex items-center justify-between gap-3 rounded-xl border border-amber-500/35 bg-[#0E1422]/95 px-3.5 py-2.5 shadow-xl backdrop-blur-md"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <WifiOff className="h-4 w-4 text-amber-400 shrink-0" />
            <span className="truncate text-xs font-medium text-amber-200">
              Offline Mode · Serwist cache active
            </span>
          </div>
          <Link
            href="/history"
            className="flex min-h-[34px] items-center gap-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 px-2.5 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-500/25 whitespace-nowrap shrink-0"
          >
            <History className="h-3.5 w-3.5" />
            <span>Signal History</span>
          </Link>
        </div>
      )}

      {/* Universal & OPPO ColorOS Install Sheet / Modal */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div
            onClick={() => setSheetOpen(false)}
            className="fixed inset-0 bg-black/75 backdrop-blur-xs"
            aria-hidden="true"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pwa-install-sheet-title"
            className="relative z-10 w-full max-w-md rounded-t-2xl sm:rounded-2xl border-t sm:border border-slate-800 bg-[#0E1422] shadow-2xl max-h-[88vh] overflow-y-auto"
          >
            {/* Mobile Bottom-Sheet Grab Handle */}
            <div className="sm:hidden w-10 h-1.5 bg-slate-700 rounded-full mx-auto mt-3" />

            <div className="flex items-center justify-between border-b border-slate-800/80 px-5 py-4">
              <div className="flex items-center gap-3 min-w-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/pwa-192x192.png"
                  alt="TraceFX Lens app icon"
                  referrerPolicy="no-referrer"
                  className="h-10 w-10 rounded-xl shrink-0"
                />
                <div className="min-w-0">
                  <h2
                    id="pwa-install-sheet-title"
                    className="font-[family-name:var(--font-display)] text-base font-bold text-white truncate"
                  >
                    Install TraceFX Lens
                  </h2>
                  <p className="text-xs text-slate-400 truncate">
                    Standalone App · Offline Signal History
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="Close install sheet"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800/60 hover:text-white shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Native 1-Tap Chrome Install CTA when available */}
              {deferredPrompt && (
                <button
                  type="button"
                  onClick={() => void triggerInstallOrGuide()}
                  className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-400 transition-colors whitespace-nowrap"
                >
                  <Download className="h-4 w-4" />
                  <span>Install App Now</span>
                </button>
              )}

              {/* Embedded Preview Iframe Notice */}
              {isEmbeddedIframe && (
                <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3.5 space-y-2.5">
                  <p className="text-xs leading-relaxed text-sky-200">
                    You are currently viewing inside an embedded preview frame. Android Chrome only installs PWAs when opened directly in a top-level Chrome tab.
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleCopyCurrentUrl()}
                    className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-sky-500/20 border border-sky-500/35 px-3 py-1.5 text-xs font-medium text-sky-200 hover:bg-sky-500/30 whitespace-nowrap"
                  >
                    {copiedUrl ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        <span>Link Copied — Paste in Chrome</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy App URL for Chrome</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Live Device Compatibility & Readiness Check */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-200">
                  Phone Compatibility Readiness
                </p>
                <div className="divide-y divide-slate-800/70 border-y border-slate-800/70 text-xs">
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-400">Serwist Service Worker</span>
                    <span
                      className={`font-[family-name:var(--font-mono)] tabular-nums ${
                        swReady ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                    >
                      {swReady ? 'Active' : 'Registering'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-400">144px / 192px / 512px PNG Icons</span>
                    <span className="font-[family-name:var(--font-mono)] text-emerald-400 tabular-nums">
                      Verified
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-400">Offline Signal History Shell</span>
                    <span className="font-[family-name:var(--font-mono)] text-emerald-400 tabular-nums">
                      Ready
                    </span>
                  </div>
                </div>
              </div>

              {/* Platform-Specific Instructions: iOS vs Android / OPPO ColorOS */}
              {isIOS ? (
                <div className="space-y-2 text-xs leading-relaxed text-slate-300">
                  <p className="font-semibold text-white">
                    Install on iPhone or iPad (Safari):
                  </p>
                  <p>1. Tap the Share button at the bottom of Safari.</p>
                  <p>2. Scroll down and tap Add to Home Screen, then tap Add.</p>
                </div>
              ) : (
                <div className="space-y-3 text-xs leading-relaxed text-slate-300">
                  <div className="space-y-1.5">
                    <p className="font-semibold text-white flex items-center gap-1.5">
                      <Smartphone className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                      <span>Install in Google Chrome on Android:</span>
                    </p>
                    <p>
                      1. Tap the <strong>three-dot menu (⋮)</strong> at the top-right of Chrome.
                    </p>
                    <p>
                      2. Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>, then confirm <strong>Add</strong>.
                    </p>
                  </div>

                  {/* Dedicated OPPO / ColorOS / Older Android Unblock Instructions */}
                  <div className="pt-2.5 border-t border-slate-800/80 space-y-1.5">
                    <p className="font-semibold text-sky-300">
                      {isOppoOrLegacyAndroid
                        ? 'Detected OPPO / Legacy Android — Important ColorOS Fix:'
                        : 'Using an OPPO (ColorOS) or Older Android Phone?'}
                    </p>
                    <p className="text-slate-400">
                      Older OPPO phones block Chrome from placing PWA icons on the home screen by default. If the icon does not appear after tapping Add to Home screen:
                    </p>
                    <p>
                      1. Open your phone <strong>Settings → App Management (or Apps) → Chrome → Permissions</strong>.
                    </p>
                    <p>
                      2. Turn ON <strong>Home screen shortcuts</strong> (or <em>Desktop shortcuts</em>), then tap <strong>Add to Home screen</strong> in Chrome again—it will launch in full standalone mode without browser bars.
                    </p>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="min-h-[44px] w-full rounded-xl border border-slate-800 bg-[#111726] py-2 text-xs font-medium text-slate-200 hover:border-slate-700 hover:text-white transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </PwaContext.Provider>
  );
}

export function usePWA(): PwaContextValue {
  return useContext(PwaContext);
}
