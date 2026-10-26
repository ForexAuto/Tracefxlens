import type {
  CrtMacroBias,
  MacroCorrelationContext,
  MacroInstrumentSnapshot,
  MacroSensitivityProfile,
  MacroSignalAlignment,
  SignalType,
} from '@/lib/trading-data';

interface MacroBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface YahooSeriesPayload {
  bars: MacroBar[];
  regularMarketPrice: number | null;
  previousClose: number | null;
  lastBarAgeSeconds: number;
}

interface RawMacroSnapshots {
  dxy: (MacroInstrumentSnapshot & {
    numericValue: number;
    pctChange: number;
  }) | null;
  us10y: (MacroInstrumentSnapshot & {
    numericValue: number;
    bpsChange: number;
  }) | null;
  fetchedAtMs: number;
}

export interface MacroCorrelationFeedResult {
  rawSnapshots: RawMacroSnapshots;
  previewContext: MacroCorrelationContext;
  promptBlock: string;
}

const MACRO_CACHE_TTL_MS = 12_000;
let cachedMacroSnapshots: RawMacroSnapshots | null = null;

const ICE_DXY_BASKET: Array<{ pair: string; exponent: number }> = [
  { pair: 'EUR/USD', exponent: -0.576 },
  { pair: 'USD/JPY', exponent: 0.136 },
  { pair: 'GBP/USD', exponent: -0.119 },
  { pair: 'USD/CAD', exponent: 0.091 },
  { pair: 'USD/SEK', exponent: 0.042 },
  { pair: 'USD/CHF', exponent: 0.036 },
];
const ICE_DXY_CONSTANT = 50.14348112;

function createTimeoutController(
  timeoutMs: number,
  parentSignal?: AbortSignal
): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onParentAbort = () => controller.abort();

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  return {
    controller,
    cleanup: () => {
      clearTimeout(timer);
      if (parentSignal) {
        parentSignal.removeEventListener('abort', onParentAbort);
      }
    },
  };
}

/**
 * Normalizes Cboe 10-Year Yield (^TNX) whether quoted at 10x face (e.g. 42.50 -> 4.250%)
 * or direct face percentage (e.g. 4.250 -> 4.250%).
 */
function normalizeUs10yPercent(raw: number): number {
  return raw > 15 ? raw / 10 : raw;
}

async function fetchYahooSeries(
  ticker: string,
  interval: '60m' | '5m',
  range: '5d' | '1d',
  parentSignal?: AbortSignal
): Promise<YahooSeriesPayload | null> {
  const { controller, cleanup } = createTimeoutController(2600, parentSignal);
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      ticker
    )}?interval=${interval}&range=${range}&includePrePost=false`;

    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; TraceFXLens/1.0)',
      },
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!res.ok) return null;
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            regularMarketPrice?: number;
            previousClose?: number;
            chartPreviousClose?: number;
          };
          timestamp?: number[];
          indicators?: {
            quote?: Array<{
              open?: Array<number | null>;
              high?: Array<number | null>;
              low?: Array<number | null>;
              close?: Array<number | null>;
            }>;
          };
        }>;
      };
    };

    const result = json?.chart?.result?.[0];
    const timestamps = result?.timestamp;
    const quote = result?.indicators?.quote?.[0];
    if (!result || !Array.isArray(timestamps) || !quote) return null;

    const bars: MacroBar[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const t = timestamps[i];
      const o = quote.open?.[i];
      const h = quote.high?.[i];
      const l = quote.low?.[i];
      const c = quote.close?.[i];
      if (
        typeof t === 'number' &&
        typeof o === 'number' &&
        typeof h === 'number' &&
        typeof l === 'number' &&
        typeof c === 'number' &&
        Number.isFinite(c) &&
        c > 0
      ) {
        bars.push({ time: t, open: o, high: h, low: l, close: c });
      }
    }

    if (bars.length < 4) return null;

    const meta = result.meta || {};
    const regularMarketPrice =
      typeof meta.regularMarketPrice === 'number' &&
      Number.isFinite(meta.regularMarketPrice) &&
      meta.regularMarketPrice > 0
        ? meta.regularMarketPrice
        : null;

    // On 5m/1d, chartPreviousClose is the prior daily session close.
    // On 60m/5d, previousClose is the prior daily session close while chartPreviousClose is 5d ago.
    const previousClose =
      typeof meta.previousClose === 'number' &&
      Number.isFinite(meta.previousClose) &&
      meta.previousClose > 0
        ? meta.previousClose
        : interval === '5m' &&
          typeof meta.chartPreviousClose === 'number' &&
          Number.isFinite(meta.chartPreviousClose) &&
          meta.chartPreviousClose > 0
        ? meta.chartPreviousClose
        : null;

    const nowSec = Math.floor(Date.now() / 1000);
    const lastBarAgeSeconds = Math.max(0, nowSec - bars[bars.length - 1].time);

    return {
      bars,
      regularMarketPrice,
      previousClose,
      lastBarAgeSeconds,
    };
  } catch {
    return null;
  } finally {
    cleanup();
  }
}

/**
 * Computes real-time 0-second Official ICE Spot DXY from Swissquote institutional FX BBO
 * across all 6 official ICE Dollar Index basket legs (EUR, JPY, GBP, CAD, SEK, CHF).
 */
async function fetchLiveIceBasketSpotDxy(
  parentSignal?: AbortSignal
): Promise<{ value: number; maxAgeSeconds: number } | null> {
  const { controller, cleanup } = createTimeoutController(2300, parentSignal);
  try {
    const legQuotes = await Promise.all(
      ICE_DXY_BASKET.map(async ({ pair, exponent }) => {
        const [base, quote] = pair.split('/');
        const res = await fetch(
          `https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${base}/${quote}`,
          {
            headers: {
              Accept: 'application/json',
              'User-Agent': 'Mozilla/5.0 (compatible; TraceFXLens/1.0)',
            },
            signal: controller.signal,
            cache: 'no-store',
          }
        );
        if (!res.ok) return null;
        const payload = (await res.json()) as Array<{
          ts?: number;
          spreadProfilePrices?: Array<{ bid?: number; ask?: number }>;
        }>;
        const firstVenue = Array.isArray(payload) ? payload[0] : null;
        const topProfile = firstVenue?.spreadProfilePrices?.[0];
        const bid = topProfile?.bid;
        const ask = topProfile?.ask;
        if (
          typeof bid !== 'number' ||
          typeof ask !== 'number' ||
          bid <= 0 ||
          ask <= 0
        ) {
          return null;
        }
        const mid = (bid + ask) / 2;
        const ageSec =
          typeof firstVenue?.ts === 'number' && firstVenue.ts > 0
            ? Math.max(0, Math.round((Date.now() - firstVenue.ts) / 1000))
            : 0;
        return { mid, exponent, ageSec };
      })
    );

    if (legQuotes.some((q) => q === null)) return null;
    const validLegs = legQuotes as Array<{
      mid: number;
      exponent: number;
      ageSec: number;
    }>;

    // Only treat as live active FX market when quotes are fresher than 180s (filters weekend freeze)
    const maxAgeSeconds = Math.max(...validLegs.map((l) => l.ageSec));
    if (maxAgeSeconds > 180) return null;

    let dxyValue = ICE_DXY_CONSTANT;
    for (const leg of validLegs) {
      dxyValue *= Math.pow(leg.mid, leg.exponent);
    }

    if (!Number.isFinite(dxyValue) || dxyValue < 60 || dxyValue > 160) {
      return null;
    }

    return { value: dxyValue, maxAgeSeconds };
  } catch {
    return null;
  } finally {
    cleanup();
  }
}

function classifySeriesStructure(
  h1Bars: MacroBar[],
  latestVal: number,
  pctOrRelDelta: number,
  flatThresholdPct: number
): 'UP' | 'DOWN' | 'FLAT' {
  const recent = h1Bars.slice(-12);
  if (recent.length < 4) {
    if (pctOrRelDelta >= flatThresholdPct) return 'UP';
    if (pctOrRelDelta <= -flatThresholdPct) return 'DOWN';
    return 'FLAT';
  }

  const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
  const secondHalf = recent.slice(Math.floor(recent.length / 2));
  const firstAvg =
    firstHalf.reduce((acc, b) => acc + b.close, 0) / firstHalf.length;
  const secondAvg =
    secondHalf.reduce((acc, b) => acc + b.close, 0) / secondHalf.length;

  const slopePct = ((latestVal - firstAvg) / Math.max(firstAvg, 1e-9)) * 100;
  const halfShiftPct =
    ((secondAvg - firstAvg) / Math.max(firstAvg, 1e-9)) * 100;

  let score = 0;
  if (slopePct >= flatThresholdPct) score += 1;
  else if (slopePct <= -flatThresholdPct) score -= 1;

  if (halfShiftPct >= flatThresholdPct * 0.65) score += 1;
  else if (halfShiftPct <= -flatThresholdPct * 0.65) score -= 1;

  if (pctOrRelDelta >= flatThresholdPct) score += 1;
  else if (pctOrRelDelta <= -flatThresholdPct) score -= 1;

  if (score >= 2) return 'UP';
  if (score <= -2) return 'DOWN';
  if (Math.abs(pctOrRelDelta) >= flatThresholdPct * 2.0) {
    return pctOrRelDelta > 0 ? 'UP' : 'DOWN';
  }
  return 'FLAT';
}

function classifyM5Impulse(
  m5Bars: MacroBar[] | null,
  latestVal: number,
  minPctMove: number
): 'UP' | 'DOWN' | 'FLAT' {
  if (!m5Bars || m5Bars.length < 4) return 'FLAT';
  const anchorIdx = Math.max(0, m5Bars.length - 7); // ~30m impulse window
  const anchorClose = m5Bars[anchorIdx].close;
  if (anchorClose <= 0) return 'FLAT';
  const movePct = ((latestVal - anchorClose) / anchorClose) * 100;
  if (movePct >= minPctMove) return 'UP';
  if (movePct <= -minPctMove) return 'DOWN';
  return 'FLAT';
}

async function fetchRawMacroSnapshots(
  parentSignal?: AbortSignal
): Promise<RawMacroSnapshots> {
  if (
    cachedMacroSnapshots &&
    Date.now() - cachedMacroSnapshots.fetchedAtMs <= MACRO_CACHE_TTL_MS &&
    (cachedMacroSnapshots.dxy || cachedMacroSnapshots.us10y)
  ) {
    return cachedMacroSnapshots;
  }

  const [spotDxy, dxyH1, dxyM5, tnxH1, tnxM5] = await Promise.all([
    fetchLiveIceBasketSpotDxy(parentSignal),
    fetchYahooSeries('DX-Y.NYB', '60m', '5d', parentSignal),
    fetchYahooSeries('DX-Y.NYB', '5m', '1d', parentSignal),
    fetchYahooSeries('^TNX', '60m', '5d', parentSignal),
    fetchYahooSeries('^TNX', '5m', '1d', parentSignal),
  ]);

  // 1. Build DXY Snapshot
  let dxySnap: RawMacroSnapshots['dxy'] = null;
  const dxyBaseSeries = dxyH1 || dxyM5;
  if (dxyBaseSeries || spotDxy) {
    const rawExchangeLast =
      dxyM5?.regularMarketPrice ??
      dxyH1?.regularMarketPrice ??
      dxyM5?.bars[dxyM5.bars.length - 1]?.close ??
      dxyH1?.bars[dxyH1.bars.length - 1]?.close ??
      null;

    // Fuse 0s ICE Spot Basket if within 1.2% of ICE exchange index (guards against bad tick)
    const useLiveBasket =
      spotDxy !== null &&
      (rawExchangeLast === null ||
        Math.abs(spotDxy.value - rawExchangeLast) / rawExchangeLast <= 0.012);

    const latestDxy = useLiveBasket
      ? spotDxy!.value
      : rawExchangeLast ?? spotDxy?.value ?? null;

    if (latestDxy !== null) {
      const prevClose =
        dxyM5?.previousClose ??
        dxyH1?.previousClose ??
        dxyH1?.bars[Math.max(0, dxyH1.bars.length - 24)]?.close ??
        latestDxy;

      const pctChange =
        prevClose > 0 ? ((latestDxy - prevClose) / prevClose) * 100 : 0;

      const dir = dxyH1
        ? classifySeriesStructure(dxyH1.bars, latestDxy, pctChange, 0.08)
        : pctChange >= 0.1
        ? 'UP'
        : pctChange <= -0.1
        ? 'DOWN'
        : 'FLAT';

      const h1Bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
        dir === 'UP' ? 'BULLISH' : dir === 'DOWN' ? 'BEARISH' : 'NEUTRAL';

      const m5Impulse = classifyM5Impulse(dxyM5?.bars ?? null, latestDxy, 0.045);

      const sessionBars = dxyM5?.bars?.length
        ? dxyM5.bars
        : dxyH1?.bars.slice(-24) ?? [];
      const sessionHigh =
        sessionBars.length > 0
          ? Math.max(latestDxy, ...sessionBars.map((b) => b.high)).toFixed(2)
          : undefined;
      const sessionLow =
        sessionBars.length > 0
          ? Math.min(latestDxy, ...sessionBars.map((b) => b.low)).toFixed(2)
          : undefined;

      const sign = pctChange > 0 ? '+' : '';
      dxySnap = {
        symbol: 'DXY',
        value: latestDxy.toFixed(2),
        numericValue: latestDxy,
        pctChange,
        changeLabel: `${sign}${pctChange.toFixed(2)}%`,
        h1Bias,
        m5Impulse,
        sessionHigh,
        sessionLow,
        ageSeconds: useLiveBasket
          ? spotDxy!.maxAgeSeconds
          : dxyM5?.lastBarAgeSeconds ?? dxyH1?.lastBarAgeSeconds ?? 0,
        source: useLiveBasket
          ? 'ICE Spot Basket + DX-Y.NYB'
          : 'ICE Dollar Index (DX-Y.NYB)',
      };
    }
  }

  // 2. Build US10Y Snapshot
  let us10ySnap: RawMacroSnapshots['us10y'] = null;
  if (tnxH1 || tnxM5) {
    const rawLast =
      tnxM5?.regularMarketPrice ??
      tnxH1?.regularMarketPrice ??
      tnxM5?.bars[tnxM5.bars.length - 1]?.close ??
      tnxH1?.bars[tnxH1.bars.length - 1]?.close ??
      null;

    if (rawLast !== null) {
      const latestYieldPct = normalizeUs10yPercent(rawLast);
      const normH1Bars = (tnxH1?.bars || []).map((b) => ({
        ...b,
        open: normalizeUs10yPercent(b.open),
        high: normalizeUs10yPercent(b.high),
        low: normalizeUs10yPercent(b.low),
        close: normalizeUs10yPercent(b.close),
      }));
      const normM5Bars = (tnxM5?.bars || []).map((b) => ({
        ...b,
        open: normalizeUs10yPercent(b.open),
        high: normalizeUs10yPercent(b.high),
        low: normalizeUs10yPercent(b.low),
        close: normalizeUs10yPercent(b.close),
      }));

      const rawPrevClose =
        tnxM5?.previousClose ??
        tnxH1?.previousClose ??
        (normH1Bars.length > 0
          ? normH1Bars[Math.max(0, normH1Bars.length - 14)].close
          : latestYieldPct);
      const prevYieldPct = normalizeUs10yPercent(rawPrevClose);

      const bpsChange = (latestYieldPct - prevYieldPct) * 100;
      const relPctDelta =
        prevYieldPct > 0
          ? ((latestYieldPct - prevYieldPct) / prevYieldPct) * 100
          : 0;

      // >= 1.8 bps or clear H1 slope marks RISING / FALLING yields
      const dir =
        normH1Bars.length >= 4
          ? classifySeriesStructure(normH1Bars, latestYieldPct, relPctDelta, 0.35)
          : bpsChange >= 1.8
          ? 'UP'
          : bpsChange <= -1.8
          ? 'DOWN'
          : 'FLAT';

      const h1Bias: 'RISING' | 'FALLING' | 'FLAT' =
        dir === 'UP' || bpsChange >= 3.0
          ? 'RISING'
          : dir === 'DOWN' || bpsChange <= -3.0
          ? 'FALLING'
          : 'FLAT';

      const m5Impulse = classifyM5Impulse(
        normM5Bars.length > 0 ? normM5Bars : null,
        latestYieldPct,
        0.18
      );

      const sessionBars = normM5Bars.length > 0 ? normM5Bars : normH1Bars.slice(-14);
      const sessionHigh =
        sessionBars.length > 0
          ? `${Math.max(latestYieldPct, ...sessionBars.map((b) => b.high)).toFixed(3)}%`
          : undefined;
      const sessionLow =
        sessionBars.length > 0
          ? `${Math.min(latestYieldPct, ...sessionBars.map((b) => b.low)).toFixed(3)}%`
          : undefined;

      const bpsSign = bpsChange > 0 ? '+' : '';
      us10ySnap = {
        symbol: 'US10Y',
        value: `${latestYieldPct.toFixed(3)}%`,
        numericValue: latestYieldPct,
        bpsChange,
        changeLabel: `${bpsSign}${bpsChange.toFixed(1)} bps`,
        h1Bias,
        m5Impulse,
        sessionHigh,
        sessionLow,
        ageSeconds: tnxM5?.lastBarAgeSeconds ?? tnxH1?.lastBarAgeSeconds ?? 0,
        source: 'Cboe 10Y Treasury Yield (^TNX)',
      };
    }
  }

  const result: RawMacroSnapshots = {
    dxy: dxySnap,
    us10y: us10ySnap,
    fetchedAtMs: Date.now(),
  };

  if (dxySnap || us10ySnap) {
    cachedMacroSnapshots = result;
  }

  return result;
}

export function resolvePairMacroSensitivity(pair: string): {
  profile: MacroSensitivityProfile;
  label: string;
} {
  const clean = pair.trim().toUpperCase().replace(/\s+/g, '');

  if (
    clean === 'XAU/USD' ||
    clean === 'XAUUSD' ||
    clean === 'XAG/USD' ||
    clean === 'XAGUSD' ||
    clean === 'XPT/USD' ||
    clean === 'XPTUSD'
  ) {
    return {
      profile: 'gold_real_yield',
      label: 'Inverse DXY & US10Y Real-Yield Proxy',
    };
  }

  if (
    clean.startsWith('EUR/USD') ||
    clean === 'EURUSD' ||
    clean.startsWith('GBP/USD') ||
    clean === 'GBPUSD' ||
    clean.startsWith('AUD/USD') ||
    clean === 'AUDUSD' ||
    clean.startsWith('NZD/USD') ||
    clean === 'NZDUSD'
  ) {
    return {
      profile: 'inverse_usd',
      label: 'Inverse USD & Rate-Spread Sensitivity',
    };
  }

  if (clean.startsWith('USD/') || (clean.startsWith('USD') && clean.length === 6)) {
    return {
      profile: 'direct_usd',
      label:
        clean.includes('JPY')
          ? 'Direct DXY & High-Beta US10Y Spread'
          : 'Direct USD & Treasury Yield Sensitivity',
    };
  }

  if (clean.endsWith('/JPY') || (clean.endsWith('JPY') && !clean.startsWith('USD'))) {
    return {
      profile: 'jpy_yield_carry',
      label: 'US10Y Global Yen-Carry Sensitivity',
    };
  }

  if (
    clean === 'EUR/GBP' ||
    clean === 'EURGBP' ||
    clean === 'EUR/AUD' ||
    clean === 'EURAUD' ||
    clean === 'GBP/AUD' ||
    clean === 'GBPAUD'
  ) {
    return {
      profile: 'usd_neutral_cross',
      label: 'USD-Neutral Cross Rate',
    };
  }

  return {
    profile: 'risk_liquidity',
    label: 'USD Macro Liquidity Sensitivity',
  };
}

function stripSnapshotInternals(
  snap:
    | RawMacroSnapshots['dxy']
    | RawMacroSnapshots['us10y']
): MacroInstrumentSnapshot | null {
  if (!snap) return null;
  return {
    symbol: snap.symbol,
    value: snap.value,
    changeLabel: snap.changeLabel,
    h1Bias: snap.h1Bias,
    m5Impulse: snap.m5Impulse,
    sessionHigh: snap.sessionHigh,
    sessionLow: snap.sessionLow,
    ageSeconds: snap.ageSeconds,
    source: snap.source,
  };
}

/**
 * Evaluates pair-specific directional pressure from DXY + US10Y and scores alignment
 * against a proposed or finalized signalType (BUY | SELL | HOLD).
 */
export function buildMacroCorrelationContext(
  dxyInput: MacroInstrumentSnapshot | null,
  us10yInput: MacroInstrumentSnapshot | null,
  pair: string,
  signalType: SignalType = 'HOLD'
): MacroCorrelationContext {
  const { profile, label: sensitivityLabel } = resolvePairMacroSensitivity(pair);

  const dxySign =
    !dxyInput || dxyInput.h1Bias === 'NEUTRAL'
      ? 0
      : dxyInput.h1Bias === 'BULLISH'
      ? 1
      : -1;

  const y10Sign =
    !us10yInput || us10yInput.h1Bias === 'FLAT'
      ? 0
      : us10yInput.h1Bias === 'RISING'
      ? 1
      : -1;

  // Compute directional leg scores (+1 = bullish for THIS pair, -1 = bearish for THIS pair)
  let dxyPairEffect = 0;
  let y10PairEffect = 0;

  switch (profile) {
    case 'inverse_usd':
    case 'gold_real_yield':
    case 'risk_liquidity':
      dxyPairEffect = -dxySign;
      y10PairEffect = -y10Sign;
      break;
    case 'direct_usd':
      dxyPairEffect = dxySign;
      y10PairEffect = y10Sign;
      break;
    case 'jpy_yield_carry':
      dxyPairEffect = 0; // Non-USD cross; DXY cancels out
      y10PairEffect = y10Sign; // Rising US10Y weakens JPY -> bullish XXX/JPY
      break;
    case 'usd_neutral_cross':
      dxyPairEffect = 0;
      y10PairEffect = 0;
      break;
  }

  const totalScore = dxyPairEffect + y10PairEffect;
  const bothAgree =
    dxyPairEffect !== 0 &&
    y10PairEffect !== 0 &&
    dxyPairEffect === y10PairEffect;
  const legsConflict =
    dxyPairEffect !== 0 &&
    y10PairEffect !== 0 &&
    dxyPairEffect !== y10PairEffect;

  const pairImpliedBias: CrtMacroBias =
    totalScore > 0 ? 'BULLISH' : totalScore < 0 ? 'BEARISH' : 'NEUTRAL';

  let signalAlignment: MacroSignalAlignment = 'neutral';
  let alignmentLabel = 'Macro Neutral';

  if (profile === 'usd_neutral_cross') {
    signalAlignment = 'neutral';
    alignmentLabel = 'USD-Neutral Cross';
  } else if (legsConflict) {
    signalAlignment = 'mixed';
    alignmentLabel = 'Mixed Macro Flow';
  } else if (signalType === 'HOLD') {
    signalAlignment = 'neutral';
    alignmentLabel =
      pairImpliedBias === 'BULLISH'
        ? 'Bullish Macro Backdrop'
        : pairImpliedBias === 'BEARISH'
        ? 'Bearish Macro Backdrop'
        : 'Neutral Macro Backdrop';
  } else {
    const tradeDir = signalType === 'BUY' ? 1 : -1;
    if (totalScore === 0) {
      signalAlignment = 'neutral';
      alignmentLabel = 'Neutral Macro Flow';
    } else if (Math.sign(totalScore) === tradeDir) {
      signalAlignment = 'tailwind';
      alignmentLabel = bothAgree ? 'Double Macro Tailwind' : 'Macro Tailwind';
    } else {
      signalAlignment = 'headwind';
      alignmentLabel = bothAgree ? 'Double Macro Headwind' : 'Macro Headwind';
    }
  }

  // Build crisp 1-sentence institutional summary
  const dxyText = dxyInput
    ? `DXY ${dxyInput.value} (${dxyInput.changeLabel}, H1 ${dxyInput.h1Bias})`
    : null;
  const y10Text = us10yInput
    ? `US10Y ${us10yInput.value} (${us10yInput.changeLabel}, H1 ${us10yInput.h1Bias})`
    : null;
  const telemetryLead = [dxyText, y10Text].filter(Boolean).join(' and ');

  let summary: string;
  if (profile === 'usd_neutral_cross') {
    summary = `${pair} is a non-USD/non-JPY cross where direct DXY exposure cancels across both legs; chart market structure governs execution exclusively.`;
  } else if (!telemetryLead) {
    summary = `Live DXY and US10Y macro feeds were unavailable; signal relies purely on calibrated chart structure.`;
  } else if (legsConflict) {
    summary = `${telemetryLead} show diverging Dollar vs. Treasury yield flow, creating mixed macro conditions—prioritize clean ${pair} liquidity sweeps and structural confirmation.`;
  } else if (signalType === 'HOLD') {
    summary =
      pairImpliedBias === 'NEUTRAL'
        ? `${telemetryLead} remain balanced with no directional macro impulse forcing ${pair} expansion yet.`
        : `${telemetryLead} lean ${pairImpliedBias.toLowerCase()} for ${pair}, awaiting confirmed chart structure before execution.`;
  } else if (signalAlignment === 'tailwind') {
    summary = `${telemetryLead} align directly with this ${pair} ${signalType} setup (${alignmentLabel.toLowerCase()}).`;
  } else if (signalAlignment === 'headwind') {
    summary = `${telemetryLead} lean against this ${pair} ${signalType} direction (${alignmentLabel.toLowerCase()})—require strict stop discipline and confirmed structural displacement.`;
  } else {
    summary = `${telemetryLead} are largely neutral right now, leaving ${pair} chart price action in primary control.`;
  }

  return {
    dxy: dxyInput,
    us10y: us10yInput,
    sensitivityProfile: profile,
    sensitivityLabel,
    pairImpliedBias,
    signalAlignment,
    alignmentLabel,
    summary,
  };
}

/**
 * Fetches live DXY + US10Y telemetry and constructs the Gemini prompt correlation block
 * within a strict <= 2.8s non-blocking budget.
 */
export async function fetchMacroCorrelationFeed(
  pair: string,
  parentSignal?: AbortSignal
): Promise<MacroCorrelationFeedResult | null> {
  const rawSnapshots = await fetchRawMacroSnapshots(parentSignal);
  const dxy = stripSnapshotInternals(rawSnapshots.dxy);
  const us10y = stripSnapshotInternals(rawSnapshots.us10y);

  if (!dxy && !us10y) return null;

  const previewContext = buildMacroCorrelationContext(dxy, us10y, pair, 'HOLD');

  const lines: string[] = [
    `LIVE INTERMARKET CORRELATION FILTER (DXY & US10Y — REAL-TIME MACRO TELEMETRY):`,
  ];

  if (dxy) {
    const rangeStr =
      dxy.sessionLow && dxy.sessionHigh
        ? ` | Intraday Range: ${dxy.sessionLow} – ${dxy.sessionHigh}`
        : '';
    lines.push(
      `- US Dollar Index (DXY): ${dxy.value} (${dxy.changeLabel}) | H1 Structure: ${dxy.h1Bias} | M5 Impulse: ${dxy.m5Impulse}${rangeStr} [${dxy.source}]`
    );
  }

  if (us10y) {
    const rangeStr =
      us10y.sessionLow && us10y.sessionHigh
        ? ` | Intraday Yield Range: ${us10y.sessionLow} – ${us10y.sessionHigh}`
        : '';
    lines.push(
      `- US 10-Year Treasury Yield (US10Y): ${us10y.value} (${us10y.changeLabel}) | H1 Trend: ${us10y.h1Bias} | M5 Impulse: ${us10y.m5Impulse}${rangeStr} [${us10y.source}]`
    );
  }

  lines.push(
    `- ${pair} Macro Sensitivity Profile: ${previewContext.sensitivityLabel} -> Live Macro Implies: ${previewContext.pairImpliedBias} pressure on ${pair}.`
  );

  if (previewContext.sensitivityProfile === 'usd_neutral_cross') {
    lines.push(
      `- CORRELATION RULE FOR ${pair}: Because ${pair} is a pure non-USD/non-JPY cross, DXY cancels out across legs. Do NOT force a DXY bias onto ${pair}; rely strictly on ${pair} chart structure.`
    );
  } else {
    const confluenceRule =
      previewContext.pairImpliedBias === 'NEUTRAL'
        ? `  2. MACRO BACKDROP: Because DXY and US10Y are currently balanced/neutral (${previewContext.alignmentLabel}), let ${pair} chart structure lead and briefly note the neutral DXY/US10Y backdrop in Step 4 or 1 bullet of technicalRationale.`
        : `  2. MACRO TAILWIND CONFLUENCE: When ${pair} chart structure aligns with the ${previewContext.pairImpliedBias} macro pressure from DXY/US10Y, cite the exact DXY/US10Y alignment in Step 4 and in 1 bullet of technicalRationale.`;

    lines.push(
      `- SMART MACRO CORRELATION RULES (CRITICAL):`,
      `  1. Chart price action (and H1 CRT dominance in Top-Down mode) remains the primary trigger, and you must NEVER invent or copy DXY/US10Y numbers onto ${pair}'s Y-axis.`,
      confluenceRule,
      `  3. COUNTER-MACRO FILTER & SMT CHECK: If BOTH DXY and US10Y move against a marginal or mid-range ${pair} setup (Double Macro Headwind), downgrade weak/unconfirmed setups to HOLD rather than fighting simultaneous Dollar + 10Y yield flow. Only approve a counter-macro BUY/SELL if the chart shows an A+ liquidity sweep + confirmed CHoCH/CRT displacement (such as SMT divergence at session highs/lows), and explicitly note the macro headwind.`
    );
  }

  return {
    rawSnapshots,
    previewContext,
    promptBlock: lines.join('\n'),
  };
}
