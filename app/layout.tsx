import type { Metadata, Viewport } from 'next';
import { Outfit, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import { PwaProvider } from '@/components/pwa-provider';
import './globals.css';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-display',
  display: 'swap',
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#090D16',
};

export const metadata: Metadata = {
  title: 'TraceFX Lens — AI Trading Chart Signal Analysis',
  description:
    'AI-powered trading chart analysis delivering precise BUY, SELL, and HOLD signals with visual chart markup, entry, stop-loss, and take-profit levels across global currency, commodity, and cryptocurrency pairs.',
  applicationName: 'TraceFX Lens',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'TraceFX',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/pwa-144x144.png', sizes: '144x144', type: 'image/png' },
      { url: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
  openGraph: {
    title: 'TraceFX Lens — AI Trading Chart Signal Analysis',
    description:
      'AI-powered trading chart analysis delivering precise BUY, SELL, and HOLD signals with visual chart markup, entry, stop-loss, and take-profit levels across global currency, commodity, and cryptocurrency pairs.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TraceFX Lens — AI Trading Chart Signal Analysis',
    description:
      'AI-powered trading chart analysis delivering precise BUY, SELL, and HOLD signals with visual chart markup, entry, stop-loss, and take-profit levels across global currency, commodity, and cryptocurrency pairs.',
  },
};

const SW_MIGRATION_GUARD_SCRIPT = `(function(){try{if(navigator.onLine===false)return;var S='tracefx-shell-v7',T='tracefx-static-v7',M='__tfx_sw_v7_migrated';var hasCtrl=!!(navigator.serviceWorker&&navigator.serviceWorker.controller);var needsReset=hasCtrl&&!localStorage.getItem(M);if(!('caches' in window)&&!needsReset)return;Promise.resolve('caches' in window?caches.keys():[]).then(function(keys){var stale=keys.filter(function(k){return k.indexOf('tracefx-')===0&&k!==S&&k!==T;});if(stale.length===0&&!needsReset){if(hasCtrl)localStorage.setItem(M,'1');return;}localStorage.setItem(M,'1');return Promise.all(stale.map(function(k){return caches.delete(k);})).then(function(){if(!('serviceWorker' in navigator))return;return navigator.serviceWorker.getRegistrations().then(function(regs){return Promise.all(regs.map(function(r){return r.unregister();}));});}).then(function(){if(!sessionStorage.getItem(M)){sessionStorage.setItem(M,'1');location.reload();}});}).catch(function(){});}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${outfit.variable} ${plusJakarta.variable} ${jetbrainsMono.variable} dark`}
    >
      <head suppressHydrationWarning>
        <script
          id="tfx-sw-v7-guard"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: SW_MIGRATION_GUARD_SCRIPT }}
        />
      </head>
      <body
        suppressHydrationWarning
        className="min-h-screen bg-[#090D16] font-[family-name:var(--font-sans)] text-slate-100 antialiased selection:bg-sky-500/25 selection:text-sky-100"
      >
        <PwaProvider>{children}</PwaProvider>
      </body>
    </html>
  );
}

