# Automatic Pixel- & Wick-Locked Chart Drawing Calibration

Eliminates vertical price drift and floating technical overlays on uploaded charts by replacing AI coordinate guessing with deterministic pixel-scanned Y-axis tick calibration, RANSAC scale fitting, and automatic candlestick body/wick snapping across both portrait and landscape mobile screenshots.

### User Review & Critical Decisions

> [!IMPORTANT]
> The calibration architecture below reflects your confirmed preferences from our Q&A and requires zero manual dragging or calibration steps from the user.

- **Confirmed Platform & Orientation Scope**: Optimized for both **portrait and landscape** screenshots from **TradingView Mobile** and **MT4 / MT5 Mobile** (supporting dark and light themes, hollow and solid candles, dashed MT4/MT5 period grids, and borderless TradingView price scales).
- **Confirmed Alignment Targets**: Fixes all three core failure modes together:
  1. Vertical price shift across Entry, Stop-Loss, Take-Profit, and key levels.
  2. Supply, Demand, Order Block, and Fair Value Gap rectangles floating in empty space away from candles.
  3. BOS, CHoCH, and HH/HL/LH/LL swing markers missing real candle wick tips.
- **Confirmed Interaction Model**: **100% automatic pixel-and-wick lock**—drawings snap accurately out of the box with no manual drag handles or two-point ruler chores.

---

### 1. Overview & Core Concept

- **What It Does**: Upgrades the chart vision and canvas rendering pipeline so every technical drawing—Entry/SL/TP position boxes, Supply/Demand & Order Block zones, Fair Value Gaps, Liquidity sweeps, Trendlines, BOS/CHoCH breaks, and Swing pivots—is mathematically locked to the screenshot's true printed price axis and physical candlestick pixels.
- **Target Audience / Persona**: Active Forex, Gold (`XAU/USD`), and Crypto traders scanning portrait or landscape screenshots directly from TradingView Mobile and MetaTrader (MT4/MT5) Mobile in Single-Chart or Top-Down CRT (`H1 → M5`) mode.
- **Key Value**: Traders can trust that drawn Entry, Stop-Loss, Take-Profit, Order Block, FVG, and BOS lines sit on the exact price levels and candle wicks visible on their screenshot.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Zero-Friction Upload**: The trader uploads or pastes any portrait or landscape screenshot from TradingView Mobile or MT4/MT5 Mobile (in Single Chart or Top-Down CRT mode).
  2. **Pre-AI Pixel & Axis Calibration**: During Step 1 of the scan, the client-side optical scanner isolates the exact candlestick plot area (excluding mobile status bars, top OHLC headers, bottom timeframe/navigation bars, and RSI/MACD sub-panes), locates every printed price label row on the right Y-axis, and segments individual candlesticks and wick tips left-to-right.
  3. **Instant Locked Overlay Rendering**: As soon as Gemini 3.1 completes the analysis, the canvas renders crisp technical overlays locked to real candle wicks and true Y-axis prices across the inline preview, fullscreen lightbox, and downloadable PNG export.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Institutional precision trading desk—high-contrast, distraction-free dark slate surfaces (`#0B101B` / `#111726`) with adaptive canvas overlays that automatically adjust stroke contrast for both dark-mode TradingView charts and light-mode MT4/MT5 white-background charts.
  - *Color Palette & Mood*: Neutral obsidian and slate framing (`60%` canvas, `30%` structural borders) reserving semantic accents (`10%`) strictly for chart meaning: Emerald (`#10B981`) for Demand/Bullish OB/TP, Rose (`#F43F5E`) for Supply/Bearish OB/SL, Sky (`#38BDF8`) for Entry, Violet (`#A855F7`) & Amber (`#F59E0B`) for Bullish/Bearish FVGs and Liquidity.
  - *Typography & Hierarchy*: Crisp geometric sans UI labels paired with tabular monospace numerals (`tabular-nums`) on all price callouts, R:R tags, and axis references so decimals align cleanly without jitter.
  - *Component Styling & Layout*: Full-viewport desktop 12-column split and ergonomic single-column mobile stack with touch targets $\ge 44\text{px}$, zero nested card clutter, and non-overlapping callout label placement on narrow portrait charts.
- **Interactive Feedback & Motion**: Smooth GPU scan-beam pass during analysis, instant `<150ms` layer toggling (`Primary Setup`, `Full Structure`, `Structure Only`, and SMC sub-layer filters), and Pass 2 visual self-check verification without layout shift.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Pre-Measured Axis Tick Pointers (`[T1]..[Tk]`) + RANSAC Scale Solver Instead of AI Coordinate Guessing**
  - *Chosen Approach*: Detect the exact pixel `Y` center of every printed price label on the right-hand Y-axis deterministically on the client canvas, stamp numbered tick markers (`[T1]`, `[T2]`, ...) onto a magnified right-axis calibration strip for Gemini 3.1, and ask the model to read the price digits at each numbered tick while removing all hardcoded example numbers from the prompt. Fit the price-to-pixel scale using outlier-resistant median-slope consensus (Theil-Sen / RANSAC).
  - *Why*: Lightweight vision models drift when estimating `0..1000` Y coordinates from scratch or copy example Y numbers from prompts, but excel at reading crisp magnified digits next to explicit `[T1]` tags. Combining exact pixel-measured `Y` positions with RANSAC eliminates vertical drift even if one label is partially occluded.
  - *Alternatives Considered*: Letting the LLM output raw `(price, y)` pairs directly (rejected—causes severe vertical offset) or requiring manual user two-point calibration (rejected—adds friction).

- **Decision 2: Strict Verification Before Accepting Any Horizontal Current-Price Line**
  - *Chosen Approach*: Disable blind horizontal colored-line hijacking; only anchor to a live Bid/Ask line when it connects directly into a detected right-axis price badge AND agrees with the RANSAC axis-tick price scale within tight tolerance.
  - *Why*: MT4/MT5 and TradingView mobile screenshots routinely contain moving averages, session separators, or prior horizontal rays that previously fooled the line scanner and shifted the entire setup off true prices.

- **Decision 3: Deterministic Candlestick Segmentation & Automatic Wick/Body Locking**
  - *Chosen Approach*: Segment real candlestick columns (`centerX`, `highY`, `lowY`, `bodyTopY`, `bodyBottomY`) across both solid and hollow candle themes while filtering out MT4/MT5 dashed period grids, then snap every Zone, Order Block, FVG, BOS/CHoCH break, and Swing tag onto actual candle geometry.
  - *Why*: Guarantees zones originate on real candles rather than empty background space, FVGs lock onto true 3-candle price imbalances, and BOS/CHoCH rays connect an actual broken swing wick tip horizontally to the exact breakout candle.

---

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     Uploaded Screenshot (Portrait / Landscape)               │
│                 TradingView Mobile  ·  MT4 / MT5 Mobile (H1 / M5)            │
└───────────────────────────────────────┬──────────────────────────────────────┘
                                        │
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│               1. Client Pre-AI Optical Geometry Scanner (Canvas)             │
│  ┌─────────────────────────┐  ┌──────────────────────┐  ┌─────────────────┐  │
│  │ PlotBox & Sub-Pane      │  │ Right Y-Axis Tick &  │  │ Candlestick &   │  │
│  │ Boundary Isolator       │  │ Live-Badge Detector  │  │ Wick Extractor  │  │
│  │ ( Portrait & Landscape )│  │ ([T1..Tk] Exact Ys)  │  │ (C[0..N] + Pivs)│  │
│  └────────────┬────────────┘  └──────────┬───────────┘  └────────┬────────┘  │
└───────────────┼──────────────────────────┼───────────────────────┼───────────┘
                │                          │                       │
                ▼                          ▼                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│            2. Stamped Calibration Visuals -> Gemini 3.1 Stream API           │
│   • Zero template example coordinates (prevents prompt coordinate echoing)   │
│   • 2x Y-Axis Strip stamped with [T1..Tk] & [LIVE] at exact pixel Ys         │
│   • Plot-bounded 0..1000 Grid + Numbered Major Swing Pivot Anchors (P1..Pm)  │
└───────────────────────────────────────┬──────────────────────────────────────┘
                                        │
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│            3. Deterministic Post-AI Scale & Candle-Wick Lock Engine          │
│  ┌────────────────────────────────────┐  ┌────────────────────────────────┐  │
│  │ RANSAC / Theil-Sen Y-Scale Solver  │  │ Structural Candle-Wick Locker  │  │
│  │ • Pairs model tick prices with     │  │ • Zones/OB -> Origin candle X  │  │
│  │   exact pixel-scanned tick Ys      │  │   & true wick/body bounds      │  │
│  │ • Rejects misread tick outliers    │  │ • FVG -> 3-candle gap bounds   │  │
│  │ • Undistorted Entry / SL / TP Y    │  │ • BOS/CHoCH -> Exact swing     │  │
│  └─────────────────┬──────────────────┘  │   wick Y to breakout candle X  │  │
│                    │                     │ • HH/HL/LH/LL -> True wick tip │  │
│                    └──────────┬──────────┴────────────────┬───────────────┘  │
└───────────────────────────────┼───────────────────────────┼──────────────────┘
                                │                           │
                                ▼                           ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│          4. Pass 2 Visual Self-Check  &  High-DPI Canvas Renderer            │
│   • Audits rendered Draft 1 overlay against ruled chart & tightens outliers  │
│   • Identical pixel-locked output across Preview, Lightbox & Saved PNG       │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - **Pre-AI Optical Payload**: Extends the client vision payload with `detectedAxisTicks` (array of `{ id: "T1", y: number }` measured directly from Y-axis text centroids plus optional `liveBadgeY`), `candleEnvelope` summary (detected candle count, right-most `lastCandleX`, highest visible wick `minHighY`, lowest visible wick `maxLowY`), and `detectedPivots` (`P1..Pm` with exact `{ id, kind: 'high' | 'low', x, y }`).
  - **Sanitized Chart Markup**: Stores validated `axisTicks` reconciled against pre-measured `T1..Tk` pixel positions, `plotBox` locked to the optical scanner's toolbar/sub-pane boundaries, and wick-locked coordinates for `zones`, `fairValueGaps`, `structureBreaks`, `liquidityLevels`, `trendlines`, and `swings`.

- **Interactive Component & State Mapping**:
  - **Upload & Mode Selection**: Uploading single or dual (`H1 + M5`) mobile screenshots normalizes high-DPI phone captures while preserving crisp Y-axis numerals, triggering optical scanning for each slot independently.
  - **Portrait vs. Landscape Boundary Detection**: Dynamically adapts X/Y scan windows to aspect ratio—handling wide right-axis columns (`16%–25%` width) and tall top/bottom mobile app bars on portrait screenshots as well as compact right axes (`7%–12%` width) on landscape screenshots, plus borderless TradingView mobile scales and MT4/MT5 multi-window indicator dividers.
  - **Automatic Post-Stream Locking & Layer Filtering**: Toggling `Primary Setup`, `Full Structure`, `Structure Only`, or category filters (`Zones & OB`, `FVG`, `BOS & Swings`, `Liquidity`, `Trendlines`) immediately re-renders from the cached RANSAC + candle-locked geometry with zero drift between inline view, fullscreen modal, and exported PNG.
  - **Graceful Fallback Recovery**: If a heavily cropped screenshot has fewer than two readable Y-axis labels, the scale solver automatically anchors top and bottom visible price extremes against the measured highest and lowest candlestick wick pixels (`minHighY` .. `maxLowY`) so drawings remain tightly bound to actual candles on screen.
