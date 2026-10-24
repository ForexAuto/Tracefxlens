import type { Metadata, Viewport } from 'next';
import { Outfit, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
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
  themeColor: '#090D16',
};

export const metadata: Metadata = {
  title: 'TraceFX Lens — AI Trading Chart Signal Analysis',
  description:
    'AI-powered trading chart analysis delivering precise BUY, SELL, and HOLD signals with visual chart markup, entry, stop-loss, and take-profit levels across global currency, commodity, and cryptocurrency pairs.',
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${plusJakarta.variable} ${jetbrainsMono.variable} dark`}
    >
      <body
        suppressHydrationWarning
        className="min-h-screen bg-[#090D16] font-[family-name:var(--font-sans)] text-slate-100 antialiased selection:bg-sky-500/25 selection:text-sky-100"
      >
        {children}
      </body>
    </html>
  );
}
