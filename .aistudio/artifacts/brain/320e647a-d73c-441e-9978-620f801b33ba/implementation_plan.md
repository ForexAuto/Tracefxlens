# Independent High Impact News & Macro Calendar Page

Build a dedicated, standalone **High Impact News** workspace that delivers real-time Red-Folder macroeconomic releases, multi-timezone scheduling, actual-vs-forecast surprise scoring, and a complete institutional **Full Overview** inspector for every single calendar event.

## User Review & Critical Decisions

> [!IMPORTANT]
> All three architectural preferences from your review are locked into this plan, including Next.js transpilation and automatic cloud-server failover for the `forexfactory` package.

- **Confirmed Decision 1 — Data Engine (`forexfactory` npm + Automatic Live JSON Fallback)**: Install and wire the `forexfactory` package (`ForexFactory` client + timezone formatting) as the primary adapter with Next.js TypeScript transpilation enabled, backed by an automatic zero-downtime failover and enrichment layer using Forex Factory's official FairEconomy weekly JSON feed and the live global economic calendar feed whenever cloud datacenter IPs hit Cloudflare `403` challenges or need real-time `actual` prints.
- **Confirmed Decision 2 — Default Event Scope**: Default to **High Impact (Red-Folder)** events on load so noise is eliminated immediately, with instant interactive filter controls to toggle **Medium Impact**, **Bank Holidays**, **Currency (`USD`, `EUR`, `GBP`, `JPY`, `AUD`, `CAD`, `CHF`, `NZD`)**, and **Date Horizon (`Today`, `Tomorrow`, `This Week`, `Next Week`)**.
- **Confirmed Decision 3 — Full Per-Event Overview Inspector**: Clicking any event opens a comprehensive **Full Overview** view combining **Official Indicator Specifications** (what it measures, reporting agency, usual currency/Gold effect, killzone window), a deterministic **Actual vs. Forecast Surprise Meter** (accounting for inverse indicators like Unemployment Rate), an **Affected Pairs Map** with 1-click jump to chart analysis, and an **AI Macro Trading Brief** covering pre-release liquidity sweep risk and post-release execution scenarios.

---

## 1. Overview & Core Concept

- **What It Does**: Provides an independent macroeconomic intelligence page accessible from the top navigation bar and sidebar drawer. Traders can scan upcoming and recently released Red-Folder catalysts with live countdowns in their preferred timezone, filter by currency or impact tier, and inspect a rich **Full Overview** dossier for every individual news release.
- **Target Audience / Persona**: Intraday and swing FX, Gold (`XAU/USD`), and Crypto traders using SMC and Top-Down CRT strategies who need to know *when* spread-widening Red-Folder catalysts hit, *whether* a print beat or missed consensus, and *how* each release drives liquidity sweeps across major pairs.
- **Key Value**: Combines the speed of a clean Red-Folder timetable with deep per-event macroeconomic context—turning raw calendar rows into actionable pre-release killzone warnings and post-release directional context without API keys or rate-limit friction.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Immediate Red-Folder Scan**: Navigating to **High Impact News** loads the current week's **High Impact** schedule grouped cleanly by day, highlighting the **Next Imminent Catalyst** (live countdown timer) at the top KPI summary bar and auto-selecting the next upcoming Red-Folder event in the desktop overview pane.
  2. **Timezone, Horizon & Currency Filtering**: Users switch display timezones (`Local Device`, `New York EDT/EST`, `London`, `Tokyo`, `UTC`) with persistent preference storage, toggle `High` / `Medium` / `Holiday` tiers, filter by currency (`ALL` or single G8 currency), switch horizons (`Today`, `Tomorrow`, `This Week`, `Next Week`), or search by indicator name (`CPI`, `NFP`, `FOMC`, `PMI`).
  3. **Full Overview Inspection (Every Single Event)**:
     - On desktop (`1440px` baseline), a sticky right-hand **Full Event Overview** inspector updates instantaneously when any row is clicked; on mobile/tablet viewports, selecting an event opens a full-height slide-over sheet with a crisp close control.
     - Displays the **3-Column Print Grid (`Actual` · `Forecast` · `Previous`)**, deterministic **Surprise Verdict** (`Bullish Beat`, `Bearish Miss`, `In-Line`, or `Pending Release`), **Official Indicator Specs** (definition, source agency, release cadence, usual effect on currency & Gold), **Affected Pairs Map** (with 1-click `"Analyze Pair"` handoff), and a server-generated **AI Macro Playbook** (auto-cached per event with manual refresh).
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Institutional macro research terminal matching TraceFX Lens—calm, structured, high-contrast dark slate with zero visual clutter.
  - *Color Palette & Mood*: Dominant `#090D16` background canvas (60%), `#111726` single-elevation structural containers and `#0D1320` recessed control bars with `1px` `border-slate-800/80` hairlines (30%), and focused semantic accents (10%): Crimson (`text-rose-400`) for `High Impact` & `Bearish Miss`, Amber (`text-amber-400`) for `Medium Impact` & imminent `< 30m` killzone alerts, Emerald (`text-emerald-400`) for `Bullish Beat`, and Sky (`text-sky-400`) for active interactive controls. Every semantic color is paired with explicit text (`High`, `Medium`, `Holiday`, `Beat`, `Miss`).
  - *Typography & Hierarchy*: `Outfit` (`--font-display`) for page header, countdown anchor, and selected event title (`text-wrap: balance`); `Plus Jakarta Sans` (`--font-sans`) for readable macroeconomic explanations; and `JetBrains Mono` (`--font-mono` with `tabular-nums`) for all timestamps, countdowns, `Actual / Forecast / Previous` figures, and surprise deltas.
  - *Component Styling & Layout*: Asymmetric `12-column` master-detail workspace on desktop (`7 columns` dense chronological event ledger + `5 columns` sticky Full Event Overview inspector) with compact `44px–52px` scannable rows separated by `1px` hairlines. Strictly enforces **zero static pill enclosures** (metadata rendered as unboxed `·`-separated text), **zero `border-l-4` stripes**, **zero nested cards-within-cards**, and **zero decorative pulsing dots**.
- **Interactive Feedback & Motion**:
  - Instant `≤ 150ms` row selection and filter transitions using compositor-only `opacity` and `transform` properties.
  - Geometry-matched loading skeletons for both the event ledger and the AI Macro Playbook section, plus clear empty states (`"No High-Impact releases scheduled in this window"` with a 1-click `"Show Medium & All Week"` action) and graceful manual refresh controls.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Resilient Dual-Layer Adapter Around the `forexfactory` Package**
  - *Chosen Approach*: Configure Next.js to transpile the raw-TypeScript `forexfactory` package, invoke `ForexFactory` (`calendarEvents` + DST-corrected timestamp normalization) inside a bounded `2.2s` server timeout, and automatically fall back to / enrich with the official FairEconomy Forex Factory JSON feed plus live economic calendar actuals (`10-minute` server cache for schedule structure, `90-second` refresh for live `actual` prints).
  - *Why*: Honors your advisor's `forexfactory` package workflow on networks that permit HTML scraping while guaranteeing `100%` reliability, accurate Daylight Saving Time offsets, multi-week horizons, and live released `actual` prints on cloud servers where Cloudflare blocks HTML scrapers.
  - *Alternatives Considered*: Relying solely on HTML scraping (fails with `HTTP 403` on cloud datacenter IPs and shifts summer timestamps by 1 hour) or relying solely on weekly static JSON (lacks live `actual` numbers and official indicator descriptions).

- **Decision 2: Inverse-Indicator Aware Surprise Scoring**
  - *Chosen Approach*: Parse numeric values and units (`%`, `K`, `M`, `B`) from `Actual` and `Forecast`, and invert polarity for labor-slack indicators (*Unemployment Rate*, *Claimant Count*, *Initial/Continuing Jobless Claims*) where a **lower** actual print is currency-bullish rather than bearish.
  - *Why*: Naive `Actual > Forecast = Bullish` logic misclassifies Unemployment spikes as bullish; domain-accurate polarity ensures traders see the true hawkish/dovish currency impact immediately.

- **Decision 3: Deterministic Official Specs + On-Demand Cached AI Macro Playbook**
  - *Chosen Approach*: Render official indicator definitions, reporting source, usual currency/Gold effect, surprise math, and affected pairs **instantly (`0ms`)** on click using live metadata + a built-in institutional macro dictionary, while streaming/fetching the tailored **AI Macro Trading Playbook** asynchronously via a server-side Gemini endpoint cached by event ID and release state.
  - *Why*: Clicking through 10 different news events feels instantaneous with zero waiting for an LLM just to read core specs, while still providing deep, event-specific SMC/CRT trading scenarios for every selected catalyst.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                 Global Navigation (Top Bar & Sidebar Drawer)                 │
│     Analyze Chart  ·  Impact News (Active)  ·  Signal History  ·  TV Engine  │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     High Impact News Workspace (Client)                      │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Top KPI & Filter Strip: Next Red-Folder Countdown · Horizon Tabs       │  │
│  │ Impact Filter (High Default | Medium | Holiday) · Currency · Timezone  │  │
│  └───────────────────┬──────────────────────────────────┬─────────────────┘  │
│                      │                                  │                    │
│                      ▼ (7-Col Master Ledger)            ▼ (5-Col Inspector)  │
│  ┌────────────────────────────────────┐  ┌────────────────────────────────┐  │
│  │ Chronological Day-Grouped Ledger   │  │ Full Event Overview Panel      │  │
│  │ • Time (TZ) · CCY · Title · Impact │─▶│ • Actual / Forecast / Previous │  │
│  │ • Actual vs Forecast · Surprise    │  │ • Inverse-Aware Surprise Meter │  │
│  │ • Mobile tap -> Slide-Over Sheet   │  │ • Official Specs & Usual Effect│  │
│  └────────────────────────────────────┘  │ • Affected Pairs -> Analyze CTA│  │
│                                          │ • AI Macro Playbook (Cached)   │  │
│                                          └──────────────┬─────────────────┘  │
└─────────────────────────────────────────────────────────┼────────────────────┘
                                                          │
                     ┌────────────────────────────────────┴────────────────┐
                     ▼                                                     ▼
┌─────────────────────────────────────────┐   ┌────────────────────────────────┐
│   Calendar Feed Server Route (Cached)   │   │  Event AI Brief Server Route   │
│  1. Primary: forexfactory npm client    │   │  • Server-side Gemini Flash    │
│     (transpiled + DST offset guard)     │   │  • Pre-release killzone risk & │
│  2. Auto-Fallback & Live Actuals Merge: │   │    post-release CRT sweep brief│
│     FairEconomy FF JSON + Live Calendar │   │  • Keyed cache by event + print│
└─────────────────────────────────────────┘   └────────────────────────────────┘
```

- **Data Model & State**:
  - **Normalized Macro Event**: Unified TypeScript record containing `eventId`, `title`, `currency` (`USD`, `EUR`, `GBP`, `JPY`, `AUD`, `CAD`, `CHF`, `NZD`), `countryCode`, `impact` (`High` | `Medium` | `Low` | `Holiday`), `timestampUtcMs` (true DST-accurate epoch ms), `actual`, `forecast`, `previous`, `surpriseDirection` (`bullish` | `bearish` | `inline` | `pending`), `surpriseDeltaText`, `officialOverview` (what it measures), `usualEffect`, `sourceAgency`, `sourceUrl`, `period`, `frequency`, and `affectedPairs` (mapped to TraceFX pair symbols and correlation polarity).
  - **AI Event Playbook**: Structured JSON payload (`headlineVerdict`, `preReleaseKillzoneNote`, `bullishScenario`, `bearishScenario`, `crtExecutionTip`) cached in server memory (and client `Map`) keyed by `eventId + actual` so once generated—or re-scored after an `actual` print drops—subsequent views resolve immediately.
  - **Client Filter & Timezone State**: Persists user's chosen `timezone` (defaulting to detected device IANA timezone with 1-click presets for `America/New_York`, `Europe/London`, `Asia/Tokyo`, `UTC`) in `localStorage`, while holding active `horizon` (`today` | `tomorrow` | `this_week` | `next_week`), `impactFilter` (`High` active by default, optional `Medium` and `Holiday`), `currencyFilter`, `searchQuery`, and `selectedEventId`.

- **Interactive Component & State Mapping**:
  - **Horizon & Refresh Controls**: Switching between `Today`, `Tomorrow`, `This Week`, and `Next Week` or clicking **Refresh Feed** fetches/filters normalized events and auto-focuses the next imminent High-Impact catalyst so the desktop Overview panel is never blank when events exist.
  - **Impact, Currency & Search Bar**: Client-side instantaneous filtering across loaded events with live result counts and a 1-click **Reset Filters** escape hatch in empty states.
  - **Timezone Selector**: Immediately reformats every event timestamp, day grouping header, and countdown tooltip using IANA timezone conversion (`ForexFactory.formatTimestamp` / `Intl.DateTimeFormat`).
  - **Event Row Selection & Pair Handoff**: Clicking any row updates `selectedEventId` (opening the slide-over drawer on mobile viewports) and triggers the cached AI Macro Playbook fetch; clicking any pair in **Affected Pairs** navigates to `/?pair=<SYMBOL>` and pre-selects that instrument in the Analyze Chart workspace.

- **Key Sequences & Integrations**:
  1. **Package & Build Setup**: Install `forexfactory` (`v1.0.0`) and add it to Next.js `transpilePackages` so its TypeScript entrypoint compiles cleanly in both `next dev` and `next build`.
  2. **Hybrid Calendar Resolution**: Server endpoint runs `ForexFactory.calendarEvents()` inside a `2.2s` `AbortController` guard; on Cloudflare `403` or missing fields, it seamlessly merges FairEconomy's official weekly Forex Factory JSON (`ff_calendar_thisweek.json`) with live multi-week economic calendar prints (`actual`, `comment`, `source`, `period`, `unit`), deduplicating by currency + normalized timestamp + indicator stem.
  3. **Cross-Page Query Parameter Handoff**: Enhance the Analyze Chart workspace boot effect to optionally read `?pair=` from the URL (when no scan is currently running) so clicking `"Analyze XAU/USD"` from a USD CPI or FOMC overview lands directly on `XAU/USD` ready for chart upload.
