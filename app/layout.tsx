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

const EARLY_PWA_CAPTURE_SCRIPT = `window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__tracefxDeferredPrompt=e;});`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${plusJakarta.variable} ${jetbrainsMono.variable} dark`}
    >
      <head>
        <link
          rel="manifest"
          href="/manifest.json"
          crossOrigin="use-credentials"
        />
        <script
          dangerouslySetInnerHTML={{ __html: EARLY_PWA_CAPTURE_SCRIPT }}
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
