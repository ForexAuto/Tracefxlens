import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import withSerwistInit from '@serwist/next';
import type { NextConfig } from 'next';

const buildRevision = crypto.randomUUID();

function getPublicIconPrecacheEntries() {
  const publicDir = path.join(process.cwd(), 'public');
  if (!fs.existsSync(publicDir)) return [];

  return fs
    .readdirSync(publicDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && /\.(?:png|svg|ico)$/i.test(entry.name)
    )
    .map((entry) => {
      const fullPath = path.join(publicDir, entry.name);
      const revision = crypto
        .createHash('md5')
        .update(fs.readFileSync(fullPath))
        .digest('hex')
        .slice(0, 16);
      return {
        url: `/${entry.name}`,
        revision,
      };
    });
}

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  cacheOnNavigation: true,
  reloadOnOnline: false,
  register: false,
  additionalPrecacheEntries: [
    { url: '/', revision: buildRevision },
    { url: '/history', revision: buildRevision },
    { url: '/news', revision: buildRevision },
    { url: '/offline', revision: buildRevision },
    ...getPublicIconPrecacheEntries(),
  ],
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Allow access to remote image placeholder.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
  output: 'standalone',
  serverExternalPackages: ['playwright-core'],
  transpilePackages: ['motion', 'forexfactory'],
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/javascript; charset=utf-8',
          },
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
          {
            key: 'Service-Worker-Allowed',
            value: '/',
          },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/manifest+json; charset=utf-8',
          },
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
        ],
      },
    ];
  },
  webpack: (config, { dev }) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify—file watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

export default withSerwist(nextConfig);
