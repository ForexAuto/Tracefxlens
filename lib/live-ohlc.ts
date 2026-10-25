import { MARKET_PAIRS } from '@/lib/trading-data';

export interface OhlcBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface HybridOhlcSummary {
  pair: string;
  timeframe: string;
  source: string;
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

function getDecimalsForPair(pair: string): number {
  const clean = pair.trim().toUpperCase();
  const match = MARKET_PAIRS.find((m) => m.symbol.toUpperCase() === clean);
  if (match) return match.decimals;
  if (clean.includes('JPY')) return 3;
  if (clean.includes('XAU') || clean.includes('BTC') || clean.includes('ETH')) return 2;
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

const YAHOO_SYMBOL_MAP: Record<string, string> = {
  'EUR/USD': 'EURUSD=X',
  'GBP/USD': 'GBPUSD=X',
  'USD/JPY': 'JPY=X',
  'USD/CHF': 'CHF=X',
  'AUD/USD': 'AUDUSD=X',
  'USD/CAD': 'CAD=X',
  'NZD/USD': 'NZDUSD=X',
  'EUR/GBP': 'EURGBP=X',
  'EUR/JPY': 'EURJPY=X',
  'GBP/JPY': 'GBPJPY=X',
  'AUD/JPY': 'AUDJPY=X',
  'CHF/JPY': 'CHFJPY=X',
  'EUR/AUD': 'EURAUD=X',
  'GBP/AUD': 'GBPAUD=X',
  'USD/ZAR': 'ZAR=X',
  'USD/MXN': 'MXN=X',
  'XAU/USD': 'GC=F',
  'XAG/USD': 'SI=F',
  'WTI/USD': 'CL=F',
  'BRENT/USD': 'BZ=F',
  'XPT/USD': 'PL=F',
  'NATGAS/USD': 'NG=F',
  'XCU/USD': 'HG=F',
  'BTC/USD': 'BTC-USD',
  'ETH/USD': 'ETH-USD',
  'SOL/USD': 'SOL-USD',
  'XRP/USD': 'XRP-USD',
  'BNB/USD': 'BNB-USD',
  'ADA/USD': 'ADA-USD',
  'AVAX/USD': 'AVAX-USD',
  'LINK/USD': 'LINK-USD',
};

function aggregateBars(bars: OhlcBar[], groupSize: number): OhlcBar[] {
  if (groupSize <= 1 || bars.length < groupSize) return bars;
  const out: OhlcBar[] = [];
  for (let i = 0; i + groupSize <= bars.length; i += groupSize) {
    const chunk = bars.slice(i, i + groupSize);
    out.push({
      time: chunk[0].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map((c) => c.high)),
      low: Math.min(...chunk.map((c) => c.low)),
      close: chunk[chunk.length - 1].close,
    });
  }
  const rem = bars.length % groupSize;
  if (rem > 0) {
    const tail = bars.slice(bars.length - rem);
    out.push({
      time: tail[0].time,
      open: tail[0].open,
      high: Math.max(...tail.map((c) => c.high)),
      low: Math.min(...tail.map((c) => c.low)),
      close: tail[tail.length - 1].close,
    });
  }
  return out;
}

async function fetchBinanceCryptoOhlc(
  baseAsset: string,
  timeframe: string,
  signal: AbortSignal
): Promise<{ bars: OhlcBar[]; source: string } | null> {
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
        return { bars, source: 'Binance Spot OHLC' };
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
): Promise<{ bars: OhlcBar[]; source: string } | null> {
  const cleanPair = pair.trim().toUpperCase();
  let yahooTicker = YAHOO_SYMBOL_MAP[cleanPair];
  if (!yahooTicker) {
    const fxMatch = cleanPair.match(/^([A-Z]{3})\/([A-Z]{3})$/);
    if (fxMatch) {
      yahooTicker = `${fxMatch[1]}${fxMatch[2]}=X`;
    } else {
      return null;
    }
  }

  const tf = timeframe.toUpperCase();
  const queryMap: Record<string, { interval: string; range: string; group: number }> = {
    M1: { interval: '1m', range: '1d', group: 1 },
    M5: { interval: '5m', range: '5d', group: 1 },
    M15: { interval: '15m', range: '5d', group: 1 },
    M30: { interval: '30m', range: '1mo', group: 1 },
    H1: { interval: '60m', range: '1mo', group: 1 },
    H4: { interval: '60m', range: '3mo', group: 4 },
    D1: { interval: '1d', range: '6mo', group: 1 },
    W1: { interval: '1wk', range: '2y', group: 1 },
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

      const aggregated = aggregateBars(rawBars, cfg.group).slice(-100);
      if (aggregated.length >= 16) {
        return { bars: aggregated, source: 'Live Market OHLC' };
      }
    } catch {
      // Try backup host
    }
  }

  return null;
}

function computeHybridMathSummary(
  pair: string,
  timeframe: string,
  bars: OhlcBar[],
  source: string
): HybridOhlcSummary | null {
  if (bars.length < 16) return null;
  const recent = bars.slice(-90);
  const decimals = getDecimalsForPair(pair);
  const last = recent[recent.length - 1];

  // 1. Exact 14-period Wilder / Simple ATR
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

  // 2. Recent Swing Highs & Swing Lows (2-bar left / 2-bar right fractal pivots)
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

  // 3. Equal Highs (EQH) & Equal Lows (EQL) liquidity clusters within 0.18 * ATR
  const eqTolerance = Math.max(atr14Numeric * 0.18, last.close * 0.00015);
  const equalHighPools: string[] = [];
  for (let i = 0; i < rawSwingHighs.length; i++) {
    for (let j = i + 1; j < rawSwingHighs.length; j++) {
      if (
        j - i >= 2 &&
        Math.abs(rawSwingHighs[i].price - rawSwingHighs[j].price) <= eqTolerance
      ) {
        const avg = (rawSwingHighs[i].price + rawSwingHighs[j].price) / 2;
        // Check if still unswept after pivot j
        let swept = false;
        for (let k = rawSwingHighs[j].idx + 1; k < recent.length; k++) {
          if (recent[k].high > avg + eqTolerance * 0.6) {
            swept = true;
            break;
          }
        }
        const tag = `${fmt(avg, decimals)}${swept ? ' (swept)' : ' (active BSL/EQH)'}`;
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
        const tag = `${fmt(avg, decimals)}${swept ? ' (swept)' : ' (active SSL/EQL)'}`;
        if (!equalLowPools.includes(tag) && equalLowPools.length < 3) {
          equalLowPools.push(tag);
        }
      }
    }
  }

  // 4. Exact Unmitigated 3-Candle Fair Value Gaps (FVGs)
  const unmitigatedBullishFvgs: string[] = [];
  const unmitigatedBearishFvgs: string[] = [];
  const minGap = atr14Numeric * 0.12;

  for (let i = 2; i < recent.length; i++) {
    const c1 = recent[i - 2];
    const c3 = recent[i];

    // Bullish FVG: c3.low > c1.high
    if (c3.low - c1.high >= minGap) {
      let mitigated = false;
      for (let k = i + 1; k < recent.length; k++) {
        if (recent[k].low <= c1.high) {
          mitigated = true;
          break;
        }
      }
      if (!mitigated) {
        unmitigatedBullishFvgs.push(`${fmt(c1.high, decimals)}–${fmt(c3.low, decimals)}`);
      }
    }

    // Bearish FVG: c1.low > c3.high
    if (c1.low - c3.high >= minGap) {
      let mitigated = false;
      for (let k = i + 1; k < recent.length; k++) {
        if (recent[k].high >= c1.low) {
          mitigated = true;
          break;
        }
      }
      if (!mitigated) {
        unmitigatedBearishFvgs.push(`${fmt(c3.high, decimals)}–${fmt(c1.low, decimals)}`);
      }
    }
  }

  const recentRangeHigh = fmt(Math.max(...recent.map((b) => b.high)), decimals);
  const recentRangeLow = fmt(Math.min(...recent.map((b) => b.low)), decimals);
  const latestClose = fmt(last.close, decimals);
  const latestHigh = fmt(last.high, decimals);
  const latestLow = fmt(last.low, decimals);
  const atr14 = fmt(atr14Numeric, decimals);

  const bullFvgSlice = unmitigatedBullishFvgs.slice(-4);
  const bearFvgSlice = unmitigatedBearishFvgs.slice(-4);

  const promptBlock = [
    `HYBRID LIVE OHLC MATHEMATICAL FEED (${pair} · ${timeframe} · ${source}):`,
    `- Live Reference Close: ${latestClose} (Latest Bar High: ${latestHigh}, Low: ${latestLow})`,
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
    `CRITICAL LIVE vs HISTORICAL GUARD: First compare the screenshot's visible Y-axis price and instrument against Live Reference Close (${latestClose}). ONLY apply these exact OHLC pip numbers if the screenshot depicts the same instrument (${pair}) near this price regime (within ~3% or matching visible swings). If the user uploaded a historical backtest chart or a different symbol than the dropdown, ALWAYS trust the screenshot's printed Y-axis numbers over this live feed!`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    pair,
    timeframe,
    source,
    decimals,
    latestClose,
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
 * Fetches live OHLC candles & mathematical SMC metrics with a strict 3.2-second timeout.
 * Never throws: returns `null` cleanly if rate-limited, offline, or unsupported so chart
 * analysis proceeds with zero interruption.
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
    const cryptoBase = CRYPTO_BASE_MAP[cleanPair];
    if (cryptoBase) {
      const binance = await fetchBinanceCryptoOhlc(
        cryptoBase,
        cleanTf,
        controller.signal
      );
      if (binance) {
        return computeHybridMathSummary(
          cleanPair,
          cleanTf,
          binance.bars,
          binance.source
        );
      }
    }

    const yahoo = await fetchYahooOhlc(cleanPair, cleanTf, controller.signal);
    if (yahoo) {
      return computeHybridMathSummary(
        cleanPair,
        cleanTf,
        yahoo.bars,
        yahoo.source
      );
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}
