/* TraceFX Lens Universal Legacy-Compatible Service Worker v7 (ES5 Safe, Hydration-Safe Network-First) */
var SHELL_CACHE = 'tracefx-shell-v7';
var STATIC_CACHE = 'tracefx-static-v7';
var INLINE_OFFLINE_KEY = '/__tracefx_inline_offline__';

var CORE_URLS = [
  '/',
  '/news',
  '/history',
  '/offline',
  '/manifest.json',
  '/icon.svg',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
  '/pwa-144x144.png',
  '/pwa-192x192.png'
];

var INLINE_OFFLINE_HTML =
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>' +
  '<meta name="viewport" content="width=device-width,initial-scale=1"/>' +
  '<meta name="theme-color" content="#090D16"/>' +
  '<title>TraceFX Lens — Offline</title>' +
  '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#090D16;color:#f1f5f9;font-family:system-ui,-apple-system,sans-serif;padding:24px;box-sizing:border-box;text-align:center}.box{max-width:400px;background:#0E1422;border:1px solid #1e293b;border-radius:16px;padding:28px 22px}h1{font-size:19px;margin:0 0 10px;color:#fff}p{font-size:13px;line-height:1.6;color:#94a3b8;margin:0 0 20px}a,button{display:inline-block;min-height:44px;line-height:44px;padding:0 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;cursor:pointer;margin:4px}a.pri{background:#0ea5e9;color:#082f49}button.sec{background:#111726;color:#e2e8f0;border:1px solid #1e293b}</style>' +
  '</head><body><div class="box"><h1>You Are Offline</h1>' +
  '<p>Live chart scanning needs internet access, cleanly reconnect or open your cached Signal History once synced.</p>' +
  '<a class="pri" href="/history">Open Signal History</a>' +
  '<button class="sec" onclick="location.reload()">Retry</button>' +
  '</div></body></html>';

function safeCacheUrl(cache, url) {
  return fetch(url, { credentials: 'same-origin', cache: 'no-cache' })
    .then(function (response) {
      if (response && response.status === 200) {
        return cache.put(url, response.clone());
      }
    })
    .catch(function () {
      /* Fault-tolerant background warm-up */
    });
}

function warmCoreInBackground() {
  caches
    .open(SHELL_CACHE)
    .then(function (cache) {
      for (var i = 0; i < CORE_URLS.length; i++) {
        safeCacheUrl(cache, CORE_URLS[i]);
      }
    })
    .catch(function () {});
}

self.addEventListener('install', function (event) {
  self.skipWaiting();
  // Instant zero-network install (<20ms) so slow mobile connections activate SW immediately
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      return cache.put(
        INLINE_OFFLINE_KEY,
        new Response(INLINE_OFFLINE_HTML, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        })
      );
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        var deletions = [];
        for (var i = 0; i < keys.length; i++) {
          var key = keys[i];
          if (
            key.indexOf('tracefx-') === 0 &&
            key !== SHELL_CACHE &&
            key !== STATIC_CACHE
          ) {
            deletions.push(caches.delete(key));
          }
        }
        return Promise.all(deletions);
      })
      .then(function () {
        return self.clients.claim();
      })
      .then(function () {
        warmCoreInBackground();
      })
  );
});

self.addEventListener('message', function (event) {
  var data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (data.type === 'WARM_CACHE') {
    var shellUrls = Array.isArray(data.routes) ? data.routes : [];
    var assetUrls = Array.isArray(data.assets) ? data.assets : [];

    event.waitUntil(
      Promise.all([
        caches.open(SHELL_CACHE).then(function (shellCache) {
          var jobs = [];
          for (var i = 0; i < shellUrls.length; i++) {
            jobs.push(safeCacheUrl(shellCache, shellUrls[i]));
          }
          return Promise.all(jobs);
        }),
        caches.open(STATIC_CACHE).then(function (staticCache) {
          var jobs = [];
          for (var j = 0; j < assetUrls.length; j++) {
            jobs.push(safeCacheUrl(staticCache, assetUrls[j]));
          }
          return Promise.all(jobs);
        })
      ])
    );
  }
});

function isStaticAsset(url) {
  var p = url.pathname;
  if (p.indexOf('/_next/webpack-hmr') === 0 || p.indexOf('.hot-update.') !== -1) {
    return false;
  }
  if (p.indexOf('/_next/static/') === 0) return true;
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    return true;
  }
  if (
    /\.(?:png|jpg|jpeg|svg|ico|webp|woff|woff2|ttf|css|js)$/i.test(p) &&
    p.indexOf('/api/') !== 0 &&
    p !== '/sw.js'
  ) {
    return true;
  }
  return false;
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (!request || request.method !== 'GET') return;

  var url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Never intercept server API routes, HMR endpoints, or service worker script itself
  if (
    url.pathname.indexOf('/api/') === 0 ||
    url.pathname === '/sw.js' ||
    url.pathname.indexOf('/_next/webpack-hmr') === 0 ||
    url.pathname.indexOf('.hot-update.') !== -1
  ) {
    return;
  }

  var isPreviewHost =
    url.hostname.indexOf('ais-dev-') === 0 ||
    url.hostname.indexOf('ais-pre-') === 0 ||
    url.hostname === 'localhost';

  // On live preview/dev servers while online, let /_next/* chunks & RSC pass straight to network
  // so unhashed Next.js dev chunks ALWAYS match fresh SSR HTML 100% of the time.
  if (
    isPreviewHost &&
    self.navigator &&
    self.navigator.onLine !== false &&
    url.pathname.indexOf('/_next/') === 0
  ) {
    return;
  }

  var acceptHeader = request.headers.get('accept') || '';
  var isRscRequest =
    request.headers.get('RSC') === '1' || url.search.indexOf('_rsc=') !== -1;
  var isHtmlNavigation =
    request.mode === 'navigate' ||
    (!isRscRequest && acceptHeader.indexOf('text/html') !== -1);

  // 1. HTML Page Navigations: Network-First -> Cached Route Shell -> Offline Page -> Inline Fallback
  if (isHtmlNavigation) {
    event.respondWith(
      fetch(request)
        .then(function (networkResponse) {
          if (networkResponse && networkResponse.status === 200) {
            var copy = networkResponse.clone();
            caches.open(SHELL_CACHE).then(function (cache) {
              cache.put(url.pathname, copy);
            });
          }
          return networkResponse;
        })
        .catch(function () {
          return caches.open(SHELL_CACHE).then(function (cache) {
            return cache
              .match(url.pathname)
              .then(function (matchedRoute) {
                if (matchedRoute) return matchedRoute;
                return cache.match('/offline');
              })
              .then(function (offlineRoute) {
                if (offlineRoute) return offlineRoute;
                return cache.match('/');
              })
              .then(function (homeRoute) {
                if (homeRoute) return homeRoute;
                return cache.match(INLINE_OFFLINE_KEY);
              });
          });
        })
    );
    return;
  }

  // 2. Next.js RSC Flight Transitions: Network-First with pathname RSC cache fallback
  if (isRscRequest) {
    if (isPreviewHost && self.navigator && self.navigator.onLine !== false) {
      return;
    }
    var rscCacheKey = '/__rsc__' + url.pathname;
    event.respondWith(
      fetch(request)
        .then(function (networkResponse) {
          if (networkResponse && networkResponse.status === 200) {
            var rscCopy = networkResponse.clone();
            caches.open(SHELL_CACHE).then(function (cache) {
              cache.put(rscCacheKey, rscCopy);
            });
          }
          return networkResponse;
        })
        .catch(function () {
          return caches.open(SHELL_CACHE).then(function (cache) {
            return cache.match(rscCacheKey).then(function (cachedRsc) {
              if (cachedRsc) return cachedRsc;
              return Response.error();
            });
          });
        })
    );
    return;
  }

  // 3. Static JS/CSS Chunks, Fonts, and Icons: Network-First with Offline Cache Fallback
  if (isStaticAsset(url)) {
    var fetchPromise =
      url.origin === self.location.origin
        ? fetch(request.url, { credentials: 'same-origin', cache: 'no-cache' })
        : fetch(request);

    event.respondWith(
      fetchPromise
        .then(function (networkAsset) {
          if (
            networkAsset &&
            (networkAsset.status === 200 || networkAsset.type === 'opaque')
          ) {
            var assetCopy = networkAsset.clone();
            caches.open(STATIC_CACHE).then(function (cache) {
              cache.put(request, assetCopy);
            });
          }
          return networkAsset;
        })
        .catch(function () {
          return caches.open(STATIC_CACHE).then(function (cache) {
            return cache
              .match(request, { ignoreSearch: true })
              .then(function (cachedAsset) {
                if (cachedAsset) return cachedAsset;
                return Response.error();
              });
          });
        })
    );
  }
});
