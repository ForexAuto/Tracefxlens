import { MARKET_PAIRS, OhlcVerificationMode } from '@/lib/trading-data';

export interface OhlcBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface LiveSpotQuote {
  bid: number;
  ask: number;
  mid: number;
  ageSeconds: number;
  source: string;
}

export interface HybridOhlcSummary {
  pair: string;
  timeframe: string;
  source: string;
  ohlcMode: Exclude<OhlcVerificationMode, 'disabled'>;
  lastBarAgeSeconds: number;
  spotAgeSeconds?: number;
  hasVerifiedSpotPrice: boolean;
  basisFiltered: boolean;
  decimals: number;
  latestClose: string;
  latestHigh: string;
  latestLow: string;
  atr14: string;
  atr14Numeric: number;
  recentRangeHigh: string;
  recentRangeLow: string;
  swingHighs: string[];
  swingLows: string[];
  unmitigatedBullishFvgs: string[];
  unmitigatedBearishFvgs: string[];
  equalHighPools: string[];
  equalLowPools: string[];
  promptBlock: string;
}

interface RawCandleFeedResult {
  bars: OhlcBar[];
  source: string;
  isFuturesProxy?: boolean;
  isUsdtProxy?: boolean;
}

function getDecimalsForPair(pair: string): number {
  const clean = pair.trim().toUpperCase();
  const match = MARKET_PAIRS.find((m) => m.symbol.toUpperCase() === clean);
  if (match) return match.decimals;
  if (clean.includes('JPY')) return 3;
  if (clean.includes('XAU') || clean.includes('BTC') || clean.includes('ETH')) {
    return 2;
  }
  return 5;
}

function fmt(val: number, decimals: number): string {
  return val.toFixed(decimals);
}

const CRYPTO_BASE_MAP: Record<string, string> = {
  'BTC/USD': 'BTC',
  'ETH/USD': 'ETH',
  'SOL/USD': 'SOL',
  'XRP/USD': 'XRP',
  'BNB/USD': 'BNB',
  'ADA/USD': 'ADA',
  'AVAX/USD': 'AVAX',
  'LINK/USD': 'LINK',
};

const SWISSQUOTE_SUPPORTED_COMMODITIES = new Set([
  'XAU/USD',
  'XAG/USD',
  'XPT/USD',
]);

const YAHOO_SYMBOL_MAP: Record<
  string,
  { ticker: string; isFuturesProxy?: boolean }
> = {
  'EUR/USD': { ticker: 'EURUSD=X' },
  'GBP/USD': { ticker: 'GBPUSD=X' },
  'USD/JPY': { ticker: 'JPY=X' },
  'USD/CHF': { ticker: 'CHF=X' },
  'AUD/USD': { ticker: 'AUDUSD=X' },
  'USD/CAD': { ticker: 'CAD=X' },
  'NZD/USD': { ticker: 'NZDUSD=X' },
  'EUR/GBP': { ticker: 'EURGBP=X' },
  'EUR/JPY': { ticker: 'EURJPY=X' },
  'GBP/JPY': { ticker: 'GBPJPY=X' },
  'AUD/JPY': { ticker: 'AUDJPY=X' },
  'CHF/JPY': { ticker: 'CHFJPY=X' },
  'EUR/AUD': { ticker: 'EURAUD=X' },
  'GBP/AUD': { ticker: 'GBPAUD=X' },
  'USD/ZAR': { ticker: 'ZAR=X' },
  'USD/MXN': { ticker: 'MXN=X' },
  'XAU/USD': { ticker: 'GC=F', isFuturesProxy: true },
  'XAG/USD': { ticker: 'SI=F', isFuturesProxy: true },
  'WTI/USD': { ticker: 'CL=F', isFuturesProxy: true },
  'BRENT/USD': { ticker: 'BZ=F', isFuturesProxy: true },
  'XPT/USD': { ticker: 'PL=F', isFuturesProxy: true },
  'NATGAS/USD': { ticker: 'NG=F', isFuturesProxy: true },
  'XCU/USD': { ticker: 'HG=F', isFuturesProxy: true },
  'BTC/USD': { ticker: 'BTC-USD' },
  'ETH/USD': { ticker: 'ETH-USD' },
  'SOL/USD': { ticker: 'SOL-USD' },
  'XRP/USD': { ticker: 'XRP-USD' },
  'BNB/USD': { ticker: 'BNB-USD' },
  'ADA/USD': { ticker: 'ADA-USD' },
  'AVAX/USD': { ticker: 'AVAX-USD' },
  'LINK/USD': { ticker: 'LINK-USD' },
};

/**
 * Aggregates lower-timeframe candles strictly by institutional UTC clock boundaries
 * (e.g., H4 = 14400s -> 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC)
 * instead of arbitrary array-index offsets so candles align with TradingView / MT5.
 */
function aggregateBarsByUtcPeriod(
  bars: OhlcBar[],
  periodSeconds: number
): OhlcBar[] {
  if (periodSeconds <= 0 || bars.length === 0) return bars;
  const sorted = [...bars].sort((a, b) => a.time - b.time);
  const buckets = new Map<number, OhlcBar>();

  for (const bar of sorted) {
    const bucketStart = Math.floor(bar.time / periodSeconds) * periodSeconds;
    const existing = buckets.get(bucketStart);
    if (!existing) {
      buckets.set(bucketStart, {
        time: bucketStart,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      });
    } else {
      if (bar.high > existing.high) existing.high = bar.high;
      if (bar.low < existing.low) existing.low = bar.low;
      existing.close = bar.close;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

/**
 * Fetches real-time institutional Spot Bid/Ask (<1s latency) from Swissquote's
 * public BBO feed for Forex pairs and Spot Precious Metals (XAU/USD, XAG/USD, XPT/USD).
 */
async function fetchSwissquoteLiveSpot(
  pair: string,
  signal: AbortSignal
): Promise<LiveSpotQuote | null> {
  const cleanPair = pair.trim().toUpperCase();
  const isForex =
    !CRYPTO_BASE_MAP[cleanPair] &&
    /^[A-Z]{3}\/[A-Z]{3}$/.test(cleanPair) &&
    !YAHOO_SYMBOL_MAP[cleanPair]?.isFuturesProxy;

  if (!isForex && !SWISSQUOTE_SUPPORTED_COMMODITIES.has(cleanPair)) {
    return null;
  }

  const [base, quote] = cleanPair.split('/');
  if (!base || !quote) return null;

  try {
    const url = `https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${encodeURIComponent(
      base
    )}/${encodeURIComponent(quote)}`;
    const res = await fetch(url, {
      signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;

    const data = (await res.json()) as Array<{
      ts?: number;
      spreadProfilePrices?: Array<{
        spreadProfile?: string;
        bid?: number;
        ask?: number;
      }>;
    }>;

    if (!Array.isArray(data) || data.length === 0) return null;
    const first = data[0];
    const profiles = first?.spreadProfilePrices;
    if (!Array.isArray(profiles) || profiles.length === 0) return null;

    const preferred =
      profiles.find((p) => p.spreadProfile?.toLowerCase() === 'prime') ||
      profiles.find((p) => p.spreadProfile?.toLowerCase() === 'standard') ||
      profiles[0];

    const bid = Number(preferred?.bid);
    const ask = Number(preferred?.ask);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
      return null;
    }

    const mid = (bid + ask) / 2;
    const tsMs = typeof first.ts === 'number' ? first.ts : Date.now();
    const ageSeconds = Math.max(0, Math.round((Date.now() - tsMs) / 1000));

    // Reject stale weekend/offline quotes older than 15 minutes
    if (ageSeconds > 900) return null;

    return {
      bid,
      ask,
      mid,
      ageSeconds,
      source: 'Swissquote Spot BBO',
    };
  } catch {
    return null;
  }
}

/**
 * Fetches true USD (not USDT) spot candles from Coinbase Exchange for major crypto pairs.
 * Coinbase tuple order is [timeSec, low, high, open, close, volume] in descending time order.
 */
async function fetchCoinbaseUsdOhlc(
  baseAsset: string,
  timeframe: string,
  signal: AbortSignal
): Promise<RawCandleFeedResult | null> {
  if (baseAsset === 'BNB') return null;

  const tf = timeframe.toUpperCase();
  const cfgMap: Record<
    string,
    { granularity: number; aggregatePeriodSec?: number }
  > = {
    M1: { granularity: 60 },
    M5: { granularity: 300 },
    M15: { granularity: 900 },
    M30: { granularity: 900, aggregatePeriodSec: 1800 },
    H1: { granularity: 3600 },
    H4: { granularity: 3600, aggregatePeriodSec: 14400 },
    D1: { granularity: 86400 },
    W1: { granularity: 86400, aggregatePeriodSec: 604800 },
  };
  const cfg = cfgMap[tf] || cfgMap.H1;

  try {
    const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(
      baseAsset
    )}-USD/candles?granularity=${cfg.granularity}`;
    const res = await fetch(url, {
      signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'TraceFXLens/1.0',
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;

    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows) || rows.length < 20) return null;

    const parsed: OhlcBar[] = rows
      .map((r) => {
        if (!Array.isArray(r) || r.length < 5) return null;
        const time = Number(r[0]);
        const low = Number(r[1]);
        const high = Number(r[2]);
        const open = Number(r[3]);
        const close = Number(r[4]);
        if (
          ![time, low, high, open, close].every(
            (n) => Number.isFinite(n) && n > 0
          )
        ) {
          return null;
        }
        return { time: Math.floor(time), open, high, low, close };
      })
      .filter((b): b is OhlcBar => b !== null)
      .sort((a, b) => a.time - b.time);

    const finalBars = cfg.aggregatePeriodSec
      ? aggregateBarsByUtcPeriod(parsed, cfg.aggregatePeriodSec).slice(-100)
      : parsed.slice(-100);

    if (finalBars.length >= 16) {
      return {
        bars: finalBars,
        source: 'Coinbase Spot USD',
        isFuturesProxy: false,
        isUsdtProxy: false,
      };
    }
  } catch {
    // Fallback to Yahoo / Binance
  }
  return null;
}

async function fetchBinanceCryptoOhlc(
  baseAsset: string,
  timeframe: string,
  signal: AbortSignal
): Promise<RawCandleFeedResult | null> {
  const intervalMap: Record<string, string> = {
    M1: '1m',
    M5: '5m',
    M15: '15m',
    M30: '30m',
    H1: '1h',
    H4: '4h',
    D1: '1d',
    W1: '1w',
  };
  const interval = intervalMap[timeframe.toUpperCase()] || '1h';
  const symbol = `${baseAsset}USDT`;

  const endpoints = [
    `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=100`,
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=100`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        signal,
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) continue;
      const rows = (await res.json()) as unknown;
      if (!Array.isArray(rows) || rows.length < 20) continue;

      const bars: OhlcBar[] = rows
        .map((r) => {
          if (!Array.isArray(r) || r.length < 5) return null;
          const open = Number.parseFloat(String(r[1]));
          const high = Number.parseFloat(String(r[2]));
          const low = Number.parseFloat(String(r[3]));
          const close = Number.parseFloat(String(r[4]));
          if (![open, high, low, close].every((n) => Number.isFinite(n) && n > 0)) {
            return null;
          }
          return {
            time: Math.floor(Number(r[0]) / 1000),
            open,
            high,
            low,
            close,
          };
        })
        .filter((b): b is OhlcBar => b !== null);

      if (bars.length >= 20) {
        return {
          bars,
          source: 'Binance USDT Proxy',
          isFuturesProxy: false,
          isUsdtProxy: true,
        };
      }
    } catch {
      // Try next endpoint
    }
  }
  return null;
}

async function fetchYahooOhlc(
  pair: string,
  timeframe: string,
  signal: AbortSignal
): Promise<RawCandleFeedResult | null> {
  const cleanPair = pair.trim().toUpperCase();
  const mapped = YAHOO_SYMBOL_MAP[cleanPair];
  let yahooTicker = mapped?.ticker;
  let isFuturesProxy = Boolean(mapped?.isFuturesProxy);

  if (!yahooTicker) {
    const fxMatch = cleanPair.match(/^([A-Z]{3})\/([A-Z]{3})$/);
    if (fxMatch) {
      yahooTicker = `${fxMatch[1]}${fxMatch[2]}=X`;
      isFuturesProxy = false;
    } else {
      return null;
    }
  }

  const tf = timeframe.toUpperCase();
  const queryMap: Record<
    string,
    { interval: string; range: string; utcBucketSec?: number }
  > = {
    M1: { interval: '1m', range: '1d' },
    M5: { interval: '5m', range: '5d' },
    M15: { interval: '15m', range: '5d' },
    M30: { interval: '30m', range: '1mo' },
    H1: { interval: '60m', range: '1mo' },
    H4: { interval: '60m', range: '3mo', utcBucketSec: 14400 },
    D1: { interval: '1d', range: '6mo' },
    W1: { interval: '1wk', range: '2y' },
  };
  const cfg = queryMap[tf] || queryMap.H1;

  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  for (const host of hosts) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(
        yahooTicker
      )}?interval=${cfg.interval}&range=${cfg.range}`;
      const res = await fetch(url, {
        signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; TraceFXLens/1.0)',
        },
        cache: 'no-store',
      });
      if (!res.ok) continue;

      const payload = (await res.json()) as {
        chart?: {
          result?: Array<{
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

      const result = payload?.chart?.result?.[0];
      const ts = result?.timestamp;
      const quote = result?.indicators?.quote?.[0];
      if (!Array.isArray(ts) || !quote || ts.length < 15) continue;

      const rawBars: OhlcBar[] = [];
      for (let i = 0; i < ts.length; i++) {
        const open = quote.open?.[i];
        const high = quote.high?.[i];
        const low = quote.low?.[i];
        const close = quote.close?.[i];
        if (
          typeof open === 'number' &&
          typeof high === 'number' &&
          typeof low === 'number' &&
          typeof close === 'number' &&
          Number.isFinite(open) &&
          Number.isFinite(high) &&
          Number.isFinite(low) &&
          Number.isFinite(close) &&
          close > 0
        ) {
          rawBars.push({ time: ts[i], open, high, low, close });
        }
      }

      const aggregated = (
        cfg.utcBucketSec
          ? aggregateBarsByUtcPeriod(rawBars, cfg.utcBucketSec)
          : rawBars
      ).slice(-100);

      if (aggregated.length >= 16) {
        return {
          bars: aggregated,
          source: isFuturesProxy
            ? 'CME/COMEX Futures Volatility'
            : CRYPTO_BASE_MAP[cleanPair]
            ? 'Yahoo Crypto USD'
            : 'Live Spot FX OHLC',
          isFuturesProxy,
          isUsdtProxy: false,
        };
      }
    } catch {
      // Try backup host
    }
  }

  return null;
}

async function fetchBestCandleFeed(
  cleanPair: string,
  cleanTf: string,
  signal: AbortSignal
): Promise<RawCandleFeedResult | null> {
  const cryptoBase = CRYPTO_BASE_MAP[cleanPair];
  if (cryptoBase) {
    // 1. Primary Crypto: Coinbase Exchange True USD Spot (zero USDT Tether basis spread)
    const coinbase = await fetchCoinbaseUsdOhlc(cryptoBase, cleanTf, signal);
    if (coinbase) return coinbase;

    // 2. Secondary Crypto: Yahoo True USD Spot (e.g. BNB-USD or fallback)
    const yahooCrypto = await fetchYahooOhlc(cleanPair, cleanTf, signal);
    if (yahooCrypto) return yahooCrypto;

    // 3. Tertiary Crypto: Binance USDT Proxy (flagged as USDT proxy for basis filtering)
    return fetchBinanceCryptoOhlc(cryptoBase, cleanTf, signal);
  }

  return fetchYahooOhlc(cleanPair, cleanTf, signal);
}

function computeHybridMathSummary(
  pair: string,
  timeframe: string,
  feed: RawCandleFeedResult,
  liveSpot: LiveSpotQuote | null
): HybridOhlcSummary | null {
  const { bars } = feed;
  if (bars.length < 16) return null;
  const recent = bars.slice(-90);
  const decimals = getDecimalsForPair(pair);
  const last = recent[recent.length - 1];
  const nowSec = Math.floor(Date.now() / 1000);
  const lastBarAgeSeconds = Math.max(0, nowSec - last.time);

  // 1. Exact 14-period ATR (scale-invariant across constant spot/futures basis)
  const trs: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const c = recent[i];
    const prevClose = recent[i - 1].close;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose)
    );
    trs.push(tr);
  }
  const atrSlice = trs.slice(-14);
  const atr14Numeric =
    atrSlice.reduce((sum, v) => sum + v, 0) / Math.max(1, atrSlice.length);
  const atr14 = fmt(atr14Numeric, decimals);

  // 2. Freshness & Spot-vs-Candle Basis Integrity Audit
  const tfUpper = timeframe.toUpperCase();
  const isFastIntraday =
    tfUpper === 'M1' || tfUpper === 'M5' || tfUpper === 'M15';
  const maxFreshBarAgeSec =
    tfUpper === 'M1'
      ? 180
      : tfUpper === 'M5'
      ? 420
      : tfUpper === 'M15'
      ? 1080
      : 4500;

  const spotDrift = liveSpot ? Math.abs(liveSpot.mid - last.close) : 0;
  const hasSignificantSpotDrift = Boolean(
    liveSpot &&
      spotDrift > Math.max(atr14Numeric * 0.25, last.close * 0.0012)
  );
  const isStaleIntradayWhenMarketOpen = Boolean(
    liveSpot && isFastIntraday && lastBarAgeSeconds > maxFreshBarAgeSec
  );

  // Filter out raw absolute candle levels whenever source is Futures (GC=F/CL=F), USDT proxy, stale intraday, or drifted from live Spot
  const basisFiltered = Boolean(
    feed.isFuturesProxy ||
      feed.isUsdtProxy ||
      hasSignificantSpotDrift ||
      isStaleIntradayWhenMarketOpen
  );

  const ohlcMode: Exclude<OhlcVerificationMode, 'disabled'> = basisFiltered
    ? 'atr_spot_only'
    : 'live_spot';

  const hasVerifiedSpotPrice = Boolean(liveSpot || !basisFiltered);
  const effectiveLatestClose = liveSpot
    ? fmt(liveSpot.mid, decimals)
    : fmt(last.close, decimals);
  const effectiveSource = basisFiltered
    ? liveSpot
      ? `${liveSpot.source} + ${feed.source}`
      : `${feed.source} (ATR Only)`
    : liveSpot
    ? `${liveSpot.source} · ${feed.source}`
    : feed.source;

  // If basisFiltered (e.g. XAU/USD GC=F futures +$13 spread & 10m delay), NEVER emit shifted candle price levels!
  if (basisFiltered) {
    const promptLines = [
      `VERIFIED MARKET VOLATILITY & LIVE SPOT TELEMETRY (${pair} · ${timeframe}):`,
      liveSpot
        ? `- Real-Time Institutional Spot Quote (${liveSpot.source}, ${liveSpot.ageSeconds}s old): Mid ${fmt(
            liveSpot.mid,
            decimals
          )} (Bid ${fmt(liveSpot.bid, decimals)} / Ask ${fmt(
            liveSpot.ask,
            decimals
          )})`
        : `- Note: Direct unauthenticated Spot OHLC is unavailable for ${pair}; raw futures/proxy price levels were filtered out to prevent basis drift.`,
      `- Verified ${timeframe} 14-Period ATR Volatility Width: ${atr14} (Recommended minimum SL buffer beyond structure wick/OB: >= 0.35x ATR = ${fmt(
        atr14Numeric * 0.35,
        decimals
      )})`,
      `CRITICAL PRICE-AXIS RULE: Read ALL absolute structural prices (Swing Highs/Lows, FVGs, Order Blocks, Entry, Stop-Loss, and TP1–TP3) STRICTLY from the uploaded chart screenshot's printed Y-axis and 2x axis crop! Use the 14-ATR width (${atr14}) strictly to size stop-loss breathing room.`,
    ];

    return {
      pair,
      timeframe,
      source: effectiveSource,
      ohlcMode: 'atr_spot_only',
      lastBarAgeSeconds,
      spotAgeSeconds: liveSpot?.ageSeconds,
      hasVerifiedSpotPrice: Boolean(liveSpot),
      basisFiltered: true,
      decimals,
      latestClose: effectiveLatestClose,
      latestHigh: effectiveLatestClose,
      latestLow: effectiveLatestClose,
      atr14,
      atr14Numeric,
      recentRangeHigh: effectiveLatestClose,
      recentRangeLow: effectiveLatestClose,
      swingHighs: [],
      swingLows: [],
      unmitigatedBullishFvgs: [],
      unmitigatedBearishFvgs: [],
      equalHighPools: [],
      equalLowPools: [],
      promptBlock: promptLines.filter(Boolean).join('\n'),
    };
  }

  // 3. Fresh, Spot-Aligned Candle Series: Compute Exact Fractal Swings, EQH/EQL & Unmitigated FVGs
  const rawSwingHighs: Array<{ idx: number; price: number }> = [];
  const rawSwingLows: Array<{ idx: number; price: number }> = [];

  for (let i = 2; i < recent.length - 2; i++) {
    const h = recent[i].high;
    if (
      h >= recent[i - 1].high &&
      h >= recent[i - 2].high &&
      h >= recent[i + 1].high &&
      h >= recent[i + 2].high
    ) {
      rawSwingHighs.push({ idx: i, price: h });
    }

    const l = recent[i].low;
    if (
      l <= recent[i - 1].low &&
      l <= recent[i - 2].low &&
      l <= recent[i + 1].low &&
      l <= recent[i + 2].low
    ) {
      rawSwingLows.push({ idx: i, price: l });
    }
  }

  const swingHighs = rawSwingHighs
    .slice(-5)
    .reverse()
    .map((s) => fmt(s.price, decimals));
  const swingLows = rawSwingLows
    .slice(-5)
    .reverse()
    .map((s) => fmt(s.price, decimals));

  const eqTolerance = Math.max(atr14Numeric * 0.18, last.close * 0.00015);
  const equalHighPools: string[] = [];
  for (let i = 0; i < rawSwingHighs.length; i++) {
    for (let j = i + 1; j < rawSwingHighs.length; j++) {
      if (
        j - i >= 2 &&
        Math.abs(rawSwingHighs[i].price - rawSwingHighs[j].price) <= eqTolerance
      ) {
        const avg = (rawSwingHighs[i].price + rawSwingHighs[j].price) / 2;
        let swept = false;
        for (let k = rawSwingHighs[j].idx + 1; k < recent.length; k++) {
          if (recent[k].high > avg + eqTolerance * 0.6) {
            swept = true;
            break;
          }
        }
        const tag = `${fmt(avg, decimals)}${
          swept ? ' (swept)' : ' (active BSL/EQH)'
        }`;
        if (!equalHighPools.includes(tag) && equalHighPools.length < 3) {
          equalHighPools.push(tag);
        }
      }
    }
  }

  const equalLowPools: string[] = [];
  for (let i = 0; i < rawSwingLows.length; i++) {
    for (let j = i + 1; j < rawSwingLows.length; j++) {
      if (
        j - i >= 2 &&
        Math.abs(rawSwingLows[i].price - rawSwingLows[j].price) <= eqTolerance
      ) {
        const avg = (rawSwingLows[i].price + rawSwingLows[j].price) / 2;
        let swept = false;
        for (let k = rawSwingLows[j].idx + 1; k < recent.length; k++) {
          if (recent[k].low < avg - eqTolerance * 0.6) {
            swept = true;
            break;
          }
        }
        const tag = `${fmt(avg, decimals)}${
          swept ? ' (swept)' : ' (active SSL/EQL)'
        }`;
        if (!equalLowPools.includes(tag) && equalLowPools.length < 3) {
          equalLowPools.push(tag);
        }
      }
    }
  }

  const unmitigatedBullishFvgs: string[] = [];
  const unmitigatedBearishFvgs: string[] = [];
  const minGap = atr14Numeric * 0.12;

  for (let i = 2; i < recent.length; i++) {
    const c1 = recent[i - 2];
    const c3 = recent[i];

    if (c3.low - c1.high >= minGap) {
      let mitigated = false;
      for (let k = i + 1; k < recent.length; k++) {
        if (recent[k].low <= c1.high) {
          mitigated = true;
          break;
        }
      }
      if (!mitigated) {
        unmitigatedBullishFvgs.push(
          `${fmt(c1.high, decimals)}–${fmt(c3.low, decimals)}`
        );
      }
    }

    if (c1.low - c3.high >= minGap) {
      let mitigated = false;
      for (let k = i + 1; k < recent.length; k++) {
        if (recent[k].high >= c1.low) {
          mitigated = true;
          break;
        }
      }
      if (!mitigated) {
        unmitigatedBearishFvgs.push(
          `${fmt(c3.high, decimals)}–${fmt(c1.low, decimals)}`
        );
      }
    }
  }

  const recentRangeHigh = fmt(Math.max(...recent.map((b) => b.high)), decimals);
  const recentRangeLow = fmt(Math.min(...recent.map((b) => b.low)), decimals);
  const latestHigh = fmt(last.high, decimals);
  const latestLow = fmt(last.low, decimals);
  const bullFvgSlice = unmitigatedBullishFvgs.slice(-4);
  const bearFvgSlice = unmitigatedBearishFvgs.slice(-4);

  const promptBlock = [
    `VERIFIED LIVE SPOT OHLC MATHEMATICAL FEED (${pair} · ${timeframe} · ${effectiveSource}):`,
    liveSpot
      ? `- Real-Time Spot Quote (${liveSpot.ageSeconds}s old): ${effectiveLatestClose} (Bid ${fmt(
          liveSpot.bid,
          decimals
        )} / Ask ${fmt(liveSpot.ask, decimals)}) | Latest ${timeframe} Bar High/Low: ${latestHigh} / ${latestLow}`
      : `- Live Spot Close (${lastBarAgeSeconds}s bar age): ${effectiveLatestClose} (Latest Bar High: ${latestHigh}, Low: ${latestLow})`,
    `- 90-Bar Visible Window High / Low: ${recentRangeHigh} / ${recentRangeLow}`,
    `- Exact 14-Period ATR (${timeframe}): ${atr14} (Recommended minimum SL structural buffer beyond swing/OB: >= 0.35x ATR = ${fmt(
      atr14Numeric * 0.35,
      decimals
    )})`,
    swingHighs.length > 0
      ? `- Exact Recent Fractal Swing Highs: ${swingHighs.join(', ')}`
      : '',
    swingLows.length > 0
      ? `- Exact Recent Fractal Swing Lows: ${swingLows.join(', ')}`
      : '',
    bullFvgSlice.length > 0
      ? `- Mathematical Unmitigated Bullish FVGs: ${bullFvgSlice.join(', ')}`
      : '',
    bearFvgSlice.length > 0
      ? `- Mathematical Unmitigated Bearish FVGs: ${bearFvgSlice.join(', ')}`
      : '',
    equalHighPools.length > 0
      ? `- Equal High Liquidity Clusters (EQH): ${equalHighPools.join(', ')}`
      : '',
    equalLowPools.length > 0
      ? `- Equal Low Liquidity Clusters (EQL): ${equalLowPools.join(', ')}`
      : '',
    `CRITICAL LIVE vs HISTORICAL GUARD: First compare the screenshot's visible Y-axis price and instrument against Live Spot Reference (${effectiveLatestClose}). ONLY apply these exact OHLC pip numbers if the screenshot depicts ${pair} near this exact price regime (within ~1.5% and matching broker scale). If the user uploaded a historical backtest chart or a broker feed with a slight pip offset, ALWAYS trust the screenshot's printed Y-axis numbers!`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    pair,
    timeframe,
    source: effectiveSource,
    ohlcMode,
    lastBarAgeSeconds,
    spotAgeSeconds: liveSpot?.ageSeconds,
    hasVerifiedSpotPrice,
    basisFiltered: false,
    decimals,
    latestClose: effectiveLatestClose,
    latestHigh,
    latestLow,
    atr14,
    atr14Numeric,
    recentRangeHigh,
    recentRangeLow,
    swingHighs,
    swingLows,
    unmitigatedBullishFvgs: bullFvgSlice,
    unmitigatedBearishFvgs: bearFvgSlice,
    equalHighPools,
    equalLowPools,
    promptBlock,
  };
}

/**
 * Fetches verified live Spot quote + OHLC candles & mathematical SMC metrics with a strict 3.2s timeout.
 * Automatically filters out delayed futures / USDT basis-drifted absolute price levels.
 */
export async function fetchHybridOhlcContext(
  pair: string,
  timeframe: string,
  parentSignal?: AbortSignal
): Promise<HybridOhlcSummary | null> {
  const cleanPair = (pair || '').trim().toUpperCase();
  const cleanTf = (timeframe || 'H1').trim().toUpperCase();
  if (!cleanPair) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3200);
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });

  try {
    const [liveSpot, candleFeed] = await Promise.all([
      fetchSwissquoteLiveSpot(cleanPair, controller.signal),
      fetchBestCandleFeed(cleanPair, cleanTf, controller.signal),
    ]);

    if (!candleFeed) return null;

    return computeHybridMathSummary(cleanPair, cleanTf, candleFeed, liveSpot);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

export interface TopDownCrtOhlcSummary {
  h1: HybridOhlcSummary | null;
  m5: HybridOhlcSummary | null;
  ohlcMode: Exclude<OhlcVerificationMode, 'disabled'>;
  crtReferenceHigh?: string;
  crtReferenceLow?: string;
  crtEquilibrium?: string;
  crtSweepMathNote?: string;
  promptBlock: string;
}

/**
 * Fetches real-time Spot BBO + BOTH H1 and M5 OHLC in parallel within a 3.4s window.
 * Only computes numerical H1 CRT Range levels when the H1 feed is verified Spot-aligned (never from 10m-delayed GC=F futures).
 */
export async function fetchTopDownCrtOhlcContext(
  pair: string,
  parentSignal?: AbortSignal
): Promise<TopDownCrtOhlcSummary | null> {
  const cleanPair = (pair || '').trim().toUpperCase();
  if (!cleanPair) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3400);
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });

  try {
    const decimals = getDecimalsForPair(cleanPair);

    const [liveSpot, h1Feed, m5Feed] = await Promise.all([
      fetchSwissquoteLiveSpot(cleanPair, controller.signal),
      fetchBestCandleFeed(cleanPair, 'H1', controller.signal),
      fetchBestCandleFeed(cleanPair, 'M5', controller.signal),
    ]);

    const h1Summary = h1Feed
      ? computeHybridMathSummary(cleanPair, 'H1', h1Feed, liveSpot)
      : null;
    const m5Summary = m5Feed
      ? computeHybridMathSummary(cleanPair, 'M5', m5Feed, liveSpot)
      : null;

    if (!h1Summary && !m5Summary) return null;

    const isAnyBasisFiltered = Boolean(
      h1Summary?.basisFiltered || m5Summary?.basisFiltered
    );
    const ohlcMode: Exclude<OhlcVerificationMode, 'disabled'> =
      isAnyBasisFiltered ? 'atr_spot_only' : 'live_spot';

    let crtReferenceHigh: string | undefined;
    let crtReferenceLow: string | undefined;
    let crtEquilibrium: string | undefined;
    let crtSweepMathNote: string | undefined;

    // ONLY compute mathematical CRT candle levels when H1 feed is genuine Spot (not delayed futures!)
    if (
      h1Feed &&
      !h1Summary?.basisFiltered &&
      h1Feed.bars.length >= 6
    ) {
      const closedBars = h1Feed.bars.slice(-8, -1);
      const developing = h1Feed.bars[h1Feed.bars.length - 1];

      let refIdx = closedBars.length - 1;
      let maxRange = -1;
      for (
        let i = Math.max(0, closedBars.length - 5);
        i < closedBars.length;
        i++
      ) {
        const span = closedBars[i].high - closedBars[i].low;
        if (span > maxRange) {
          maxRange = span;
          refIdx = i;
        }
      }

      const refBar = closedBars[refIdx];
      const eq = (refBar.high + refBar.low) / 2;
      crtReferenceHigh = fmt(refBar.high, decimals);
      crtReferenceLow = fmt(refBar.low, decimals);
      crtEquilibrium = fmt(eq, decimals);

      const subsequent = [...closedBars.slice(refIdx + 1), developing];
      let sweptLow = false;
      let sweptHigh = false;
      for (const b of subsequent) {
        if (b.low < refBar.low) sweptLow = true;
        if (b.high > refBar.high) sweptHigh = true;
      }

      const livePriceNum = liveSpot ? liveSpot.mid : developing.close;
      if (sweptLow && !sweptHigh && livePriceNum > refBar.low) {
        crtSweepMathNote = `Bullish H1 CRT Purge detected: price swept below H1 CRT Low (${crtReferenceLow}) and reclaimed inside range (current ${fmt(
          livePriceNum,
          decimals
        )}; 50% EQ at ${crtEquilibrium}, opposing CRT High target at ${crtReferenceHigh}).`;
      } else if (sweptHigh && !sweptLow && livePriceNum < refBar.high) {
        crtSweepMathNote = `Bearish H1 CRT Purge detected: price swept above H1 CRT High (${crtReferenceHigh}) and rejected back inside range (current ${fmt(
          livePriceNum,
          decimals
        )}; 50% EQ at ${crtEquilibrium}, opposing CRT Low target at ${crtReferenceLow}).`;
      } else if (!sweptLow && !sweptHigh) {
        crtSweepMathNote = `Inside H1 CRT Range (${crtReferenceLow} – ${crtReferenceHigh}, 50% EQ ${crtEquilibrium}): neither CRT High nor CRT Low has been purged yet unless reacting from an internal H1 OB/FVG.`;
      } else {
        crtSweepMathNote = `Active H1 Reference Range: Low ${crtReferenceLow} · 50% EQ ${crtEquilibrium} · High ${crtReferenceHigh}.`;
      }
    }

    if (isAnyBasisFiltered) {
      const filteredLines: string[] = [
        `TOP-DOWN VERIFIED SPOT & ATR VOLATILITY TELEMETRY (${cleanPair}):`,
        liveSpot
          ? `- Real-Time Institutional Spot Quote (${liveSpot.source}, ${liveSpot.ageSeconds}s old): Mid ${fmt(
              liveSpot.mid,
              decimals
            )} (Bid ${fmt(liveSpot.bid, decimals)} / Ask ${fmt(
              liveSpot.ask,
              decimals
            )})`
          : `- Direct Spot BBO unavailable for ${cleanPair}; delayed futures absolute prices were filtered out.`,
        h1Summary
          ? `- H1 Macro 14-Period ATR Width: ${h1Summary.atr14}`
          : '',
        m5Summary
          ? `- M5 Execution 14-Period ATR Width: ${m5Summary.atr14} (Tight M5 SL buffer >= 0.5x M5 ATR = ${fmt(
              m5Summary.atr14Numeric * 0.5,
              decimals
            )})`
          : '',
        `CRITICAL SPOT-AXIS RULE: Delayed futures candle prices were intentionally stripped to prevent futures-to-spot basis drift. Read ALL H1 CRT High, CRT Low, 50% Equilibrium, M5 CHoCH/FVG, Entry, Stop-Loss, and TP1–TP3 prices STRICTLY from the uploaded H1 and M5 screenshots' printed Y-axes! Use the H1 and M5 ATR widths solely to validate stop-loss risk compression.`,
      ];

      return {
        h1: h1Summary,
        m5: m5Summary,
        ohlcMode: 'atr_spot_only',
        promptBlock: filteredLines.filter(Boolean).join('\n'),
      };
    }

    const lines: string[] = [
      `TOP-DOWN DUAL-TIMEFRAME VERIFIED LIVE SPOT OHLC FEED (${cleanPair}):`,
      liveSpot
        ? `- Real-Time Institutional Spot Quote (${liveSpot.source}, ${liveSpot.ageSeconds}s old): ${fmt(
            liveSpot.mid,
            decimals
          )} (Bid ${fmt(liveSpot.bid, decimals)} / Ask ${fmt(
            liveSpot.ask,
            decimals
          )})`
        : '',
    ];

    if (h1Summary) {
      lines.push(
        `[1] DOMINATING H1 MACRO FEED (${h1Summary.source}):`,
        `- H1 Latest Spot Close: ${h1Summary.latestClose} | H1 14-ATR: ${h1Summary.atr14}`,
        crtReferenceHigh && crtReferenceLow
          ? `- Dominant H1 CRT Candle Range: Low ${crtReferenceLow} | 50% Equilibrium ${crtEquilibrium} | High ${crtReferenceHigh}`
          : '',
        crtSweepMathNote ? `- H1 CRT Sweep Telemetry: ${crtSweepMathNote}` : '',
        h1Summary.swingHighs.length > 0
          ? `- H1 Swing Highs (Macro Liquidity Targets): ${h1Summary.swingHighs.join(', ')}`
          : '',
        h1Summary.swingLows.length > 0
          ? `- H1 Swing Lows (Macro Liquidity Targets): ${h1Summary.swingLows.join(', ')}`
          : '',
        h1Summary.unmitigatedBullishFvgs.length > 0
          ? `- H1 Unmitigated Bullish FVGs: ${h1Summary.unmitigatedBullishFvgs.join(', ')}`
          : '',
        h1Summary.unmitigatedBearishFvgs.length > 0
          ? `- H1 Unmitigated Bearish FVGs: ${h1Summary.unmitigatedBearishFvgs.join(', ')}`
          : ''
      );
    }

    if (m5Summary) {
      lines.push(
        `[2] M5 EXECUTION MICROSCOPE FEED (${m5Summary.source}):`,
        `- M5 Latest Spot Close: ${m5Summary.latestClose} | M5 14-ATR: ${m5Summary.atr14} (Tight M5 SL buffer >= 0.5x M5 ATR = ${fmt(
          m5Summary.atr14Numeric * 0.5,
          decimals
        )})`,
        m5Summary.swingHighs.length > 0
          ? `- M5 Micro Swing Highs: ${m5Summary.swingHighs.join(', ')}`
          : '',
        m5Summary.swingLows.length > 0
          ? `- M5 Micro Swing Lows: ${m5Summary.swingLows.join(', ')}`
          : '',
        m5Summary.unmitigatedBullishFvgs.length > 0
          ? `- M5 Unmitigated Bullish FVGs: ${m5Summary.unmitigatedBullishFvgs.join(', ')}`
          : '',
        m5Summary.unmitigatedBearishFvgs.length > 0
          ? `- M5 Unmitigated Bearish FVGs: ${m5Summary.unmitigatedBearishFvgs.join(', ')}`
          : ''
      );
    }

    lines.push(
      `CRITICAL LIVE vs HISTORICAL GUARD: Compare the uploaded H1 and M5 screenshots' printed Y-axis scales against this live Spot price (${
        m5Summary?.latestClose || h1Summary?.latestClose || ''
      }). ONLY use these exact live OHLC numbers if the screenshots depict ${cleanPair} in this exact price regime (within ~1.5%); if the user uploaded historical backtest charts, ALWAYS trust the screenshots' printed Y-axis numbers!`
    );

    return {
      h1: h1Summary,
      m5: m5Summary,
      ohlcMode: 'live_spot',
      crtReferenceHigh,
      crtReferenceLow,
      crtEquilibrium,
      crtSweepMathNote,
      promptBlock: lines.filter(Boolean).join('\n'),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}
