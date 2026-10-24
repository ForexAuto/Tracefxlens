# Universal & Legacy-Compatible PWA Upgrade (OPPO / Android Ready)

Transform **TraceFX Lens** into an installable standalone Progressive Web App engineered specifically to pass strict legacy Android and OPPO ColorOS checks—delivering a native full-window launch without browser bars, offline access to the app shell and saved **Signal History**, and a guided in-app installer that handles older Android devices cleanly.

## User Review & Critical Decisions

> [!IMPORTANT]
> Older OPPO (ColorOS) phones reject many modern PWAs because of four specific failure points: modern JavaScript syntax inside bundled service workers, missing legacy raster PNG sizes (`144×144` / `192×192`), uncredentialed manifest requests failing with `403`, and ColorOS blocking silent WebAPK installs unless shortcut compatibility is configured. Every decision below directly eliminates those rejection causes.

- **Confirmed — Browser Target**: Optimized first for **Google Chrome on Android** (including older Chrome builds on un-updated OPPO / ColorOS devices), while remaining 100% compatible with modern Android, desktop Chrome/Edge, and iOS Safari.
- **Confirmed — Offline Behavior**: Caches the full application shell, typography, and static bundles so opening TraceFX Lens with zero internet loads cleanly and lets you browse, filter, and inspect all locally archived setups and chart markups in **Signal History**.
- **Confirmed — Standalone Native Window**: Launches from your phone home screen in `standalone` display mode with matching `#090D16` obsidian status bar and splash screen—no Chrome address bar or browser tabs.

---

## 1. Overview & Core Concept

- **What It Does**: Packages TraceFX Lens as a lightweight, self-healing Progressive Web App with a fault-tolerant legacy-safe service worker, complete multi-resolution binary PNG icon set, offline connectivity detection, and an in-app installation experience tailored for both standard WebAPK install and OPPO ColorOS home-screen shortcut mode.
- **Target Audience / Persona**: Mobile-first traders using Android phones—including older OPPO / ColorOS handsets whose OS security updates have ended—who need fast home-screen launch and reliable offline access to their signal ledger.
- **Key Value**: Installs reliably on phones that normally reject modern PWAs, launches like a native dark-mode trading app, and preserves access to your saved trade history even when mobile data drops.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **One-Tap In-App Installation (Header & Navigation Drawer)**:
   - When opened in Chrome (and not yet running as an installed app), a clean **Install App** button appears in the navigation drawer and top bar.
   - If Chrome's native install prompt is ready, tapping **Install App** triggers the native Android installation sheet immediately.
   - Once installed and opened from your OPPO home screen, the **Install App** controls automatically hide themselves so the standalone app feels completely native.
2. **OPPO / Legacy Android Smart Install Sheet**:
   - If an older OPPO phone's Google Play Services withholds the silent WebAPK prompt (or if you tap **Install Help**), a clean slide-up mobile sheet displays live real-time readiness checks (*HTTPS Secure*, *Service Worker Active*, *Manifest Ready*, *Offline Shell Cached*) alongside exact 2-step Chrome + ColorOS instructions (including enabling OPPO's *Home screen shortcuts* permission if ColorOS blocks icon creation).
3. **Seamless Offline Signal History Access**:
   - When your phone loses signal or enters airplane mode, a compact, non-intrusive offline bar appears with a one-tap link to **Signal History**, where all previously analyzed setups and marked charts stored on-device load instantaneously without network errors.

### Visual Identity & Theme

- **Aesthetic Direction**: Native dark-slate trading utility—seamless transition from the Android home screen icon to the `#090D16` splash screen and standalone app header with zero white flash on startup.
- **Color Palette & Mood (60-30-10 Discipline)**:
  - *60% Dominant Neutral Canvas*: Deep obsidian (`#090D16`) matching both Android system `theme_color` and splash `background_color`.
  - *30% Structural Surfaces*: Single-elevation `#0E1422` and `#111726` containers with crisp 1px hairline borders (`border-slate-800/80`).
  - *10% Accent Budget*: Sky blue (`#38BDF8`) for primary install actions, emerald (`#10B981`) for verified device-readiness checks, and amber (`#F59E0B`) for offline connectivity notice.
- **Typography & Hierarchy**:
  - Retains `Outfit` for display titles, `Plus Jakarta Sans` for crisp single-line mobile controls, and `JetBrains Mono` (`tabular-nums`) for cache/readiness status—zero static pill clutter or fake version tags.
- **Mobile Touch Ergonomics**:
  - Every interactive install trigger, sheet action, and navigation row enforces a minimum `44×44px` touch hitbox.
  - Aggregate sticky UI (compact `56px` top header + conditional offline bar) stays strictly within the **15% mobile viewport height cap**, leaving maximum screen area for charts.
- **Custom Brand Icon Set**:
  - High-contrast obsidian-and-sky geometric reticle emblem rendered into true binary 8-bit RGBA PNGs across all legacy and modern sizes (`72×72`, `96×96`, `128×128`, `144×144`, `192×192`, `384×384`, `512×512`) plus a dedicated padded safe-zone `512×512` maskable icon for adaptive Android launchers and `180×180` touch icon.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Fault-Tolerant ES5 Classic Service Worker Over Heavy Bundled Workbox**
  - *Chosen Approach*: Write a clean, zero-dependency, ES5-compatible classic service worker instead of a module-bundled Workbox build.
  - *Why*: Un-updated Android phones often run older Chromium engines where ES2022+ syntax or `type: "module"` workers fail to parse—and if a single precached chunk fails `addAll()`, Workbox aborts installation completely, causing Chrome to reject the PWA. A fault-tolerant ES5 worker guarantees registration succeeds on every Android version from Android 6 through Android 15.
  - *Alternatives Considered*: Bundler-generated Workbox worker (rejected due to fragile all-or-nothing precache failures and older WebView syntax incompatibility); `next-pwa` (deprecated and incompatible with Next.js 15).
- **Decision 2: Credentialed Manifest + Complete Legacy Raster PNG Matrix**
  - *Chosen Approach*: Serve the Web App Manifest with `crossorigin="use-credentials"`, `prefer_related_applications: false`, `short_name: "TraceFX"` (7 characters), `display: "standalone"`, and separate `purpose: "any"` vs. `purpose: "maskable"` true raster PNG icons including `144×144` and `192×192`.
  - *Why*: Solves silent `403` manifest fetch failures on authenticated preview links and satisfies older Android WebAPK minters that strictly validate exact PNG pixel dimensions and reject combined `"any maskable"` or SVG-only manifests.
- **Decision 3: Network-First Navigation with Cached Shell + IndexedDB History**
  - *Chosen Approach*: Use Network-First with fast fallback to cached route shells for page navigations, Cache-First for immutable static assets/fonts/icons, and bypass caching on live AI streaming API calls.
  - *Why*: Ensures you always get the newest app updates when online, never caches stale AI API responses, and still opens the full UI + local IndexedDB **Signal History** instantaneously when offline.

---

## 4. Technical Architecture & Data Strategy

### Architecture & Component Diagram

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                 TraceFX Lens Standalone Mobile & Desktop Shell               │
│                                                                              │
│  ┌────────────────────────────────────┐  ┌────────────────────────────────┐  │
│  │  Header & Sidebar Install Trigger  │  │  Offline Connectivity Banner   │  │
│  │  • Auto-hides in standalone mode   │  │  • Live online/offline listener│  │
│  │  • Fires native Chrome prompt      │  │  • Quick jump to Signal History│  │
│  └─────────────────┬──────────────────┘  └────────────────┬───────────────┘  │
│                    ▼                                      │                  │
│  ┌────────────────────────────────────┐                   │                  │
│  │  Universal & OPPO Install Sheet    │                   │                  │
│  │  • Live SW / Manifest / HTTPS check│                   │                  │
│  │  • 1-Tap WebAPK or ColorOS guide   │                   │                  │
│  └─────────────────┬──────────────────┘                   │                  │
└────────────────────┼──────────────────────────────────────┼──────────────────┘
                     │                                      ▼
┌────────────────────┴─────────────────────────────────────────────────────────┐
│             Legacy-Safe ES5 Service Worker & Credentialed Manifest           │
│                                                                              │
│  ┌────────────────────────────────────┐  ┌────────────────────────────────┐  │
│  │  Web App Manifest & PNG Matrix     │  │  Offline Cache & Local Ledger  │  │
│  │  • 72/96/128/144/192/384/512 PNGs  │  │  • App Shell: /, /history      │  │
│  │  • Separate 512 Maskable Safe-Zone │  │  • Static JS/CSS & Font Cache  │  │
│  │  • standalone + #090D16 splash     │  │  • IndexedDB Signal History    │  │
│  └────────────────────────────────────┘  └────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State

- **Install Readiness State**: Tracks `deferredPrompt` (`beforeinstallprompt` captured early at window load so fast page loads never miss the event), `isStandalone` (`display-mode: standalone` and navigator standalone flag), `swReady` (active service worker registration), `isOPPOOrAndroid` user-agent hint, and `isIOS` detection.
- **Service Worker Cache Buckets**:
  - *App Shell Cache*: Stores `/`, `/history`, `/tv-engine`, `/offline`, manifest, and core icons with fault-tolerant individual puts.
  - *Static Asset Cache*: Caches immutable Next.js static bundles, CSS, and font files for instant cold starts on older phone storage/networks.
  - *Local Signal Ledger (Existing IndexedDB)*: Already stores full signal records and compressed chart markups locally on the phone, automatically accessible offline once the `/history` shell is cached.

### Interactive Component & State Mapping

- **Early Prompt Listener & SW Registrar**: Attaches a global `beforeinstallprompt` listener immediately on client boot (before React hydration completes if Chrome fires early), registers the root ES5 service worker, and silently warms the `/history` route in the background so offline Signal History works even if the user hasn't manually visited `/history` yet.
- **In-App Install Button & Diagnostic Drawer**: Displays in the top bar / navigation sidebar when not yet installed; clicking either invokes Chrome's native `prompt()` immediately or opens the **Install & OPPO Compatibility Sheet** showing verified green checkmarks for Manifest, Service Worker, and Offline Cache plus clear ColorOS shortcut instructions.
- **Offline Fallback View & Connectivity Bar**: Detects `offline` / `online` transitions in real time; if a user navigates to an uncached URL while offline, serves a clean dark-mode offline screen with a direct button to open cached **Signal History** or retry connection.
