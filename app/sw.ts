import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { NetworkOnly, Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
  interface Window {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

const swScope = self as unknown as ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  cacheId: 'tracefx-serwist',
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ sameOrigin, url: { pathname } }) =>
        sameOrigin &&
        (pathname.startsWith('/api/analyze') ||
          pathname.startsWith('/api/tv-engine')),
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: '/offline',
        matcher({ request }) {
          return request.destination === 'document';
        },
      },
    ],
  },
});

// Purge legacy custom ES5 caches (tracefx-shell-*, tracefx-static-*) upon Serwist activation
swScope.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith('tracefx-') && !key.startsWith('tracefx-serwist')
          )
          .map((key) => caches.delete(key))
      )
    )
  );
});

serwist.addEventListeners();
