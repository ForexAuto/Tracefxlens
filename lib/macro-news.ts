export type NewsImpactTier = 'High' | 'Medium' | 'Low' | 'Holiday';

export type NewsHorizon = 'today' | 'tomorrow' | 'this_week' | 'next_week';

export type NewsSurpriseDirection = 'bullish' | 'bearish' | 'inline' | 'pending';

export interface AffectedPairMapping {
  symbol: string;
  relationship: string;
  bullishCurrencyEffect: 'UP' | 'DOWN';
}

export interface MacroCalendarEvent {
  eventId: string;
  title: string;
  currency: string;
  countryName: string;
  impact: NewsImpactTier;
  timestampUtcMs: number;
  isAllDayOrTentative: boolean;
  rawTimeLabel: string;
  actual: string;
  forecast: string;
  previous: string;
  unit: string;
  period: string;
  surpriseDirection: NewsSurpriseDirection;
  surpriseLabel: string;
  surpriseDeltaText: string;
  officialOverview: string;
  usualEffect: string;
  whyTradersCare: string;
  sourceAgency: string;
  sourceUrl: string;
  frequency: string;
  killzoneGuidance: string;
  affectedPairs: AffectedPairMapping[];
  dataOrigin: 'forexfactory_npm' | 'forexfactory_hybrid_json';
}

export interface EventAiMacroBrief {
  eventId: string;
  headlineVerdict: string;
  preReleaseKillzoneNote: string;
  bullishPrintPlaybook: string;
  bearishPrintPlaybook: string;
  crtExecutionTip: string;
  generatedBy: 'gemini' | 'deterministic';
  generatedAtIso: string;
}

export interface TimezoneOption {
  id: string;
  label: string;
  shortTag: string;
}

export const TIMEZONE_PRESETS: TimezoneOption[] = [
  { id: 'LOCAL', label: 'Local Device Time', shortTag: 'Local' },
  { id: 'America/New_York', label: 'New York (NY Session)', shortTag: 'NY' },
  { id: 'Europe/London', label: 'London (LDN Session)', shortTag: 'LDN' },
  { id: 'Asia/Tokyo', label: 'Tokyo (TKY Session)', shortTag: 'TKY' },
  { id: 'UTC', label: 'UTC Institutional', shortTag: 'UTC' },
];

export const MAJOR_NEWS_CURRENCIES = [
  'ALL',
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'AUD',
  'CAD',
  'CHF',
  'NZD',
] as const;

export const CURRENCY_COUNTRY_NAME: Record<string, string> = {
  USD: 'United States',
  EUR: 'Eurozone',
  GBP: 'United Kingdom',
  JPY: 'Japan',
  AUD: 'Australia',
  CAD: 'Canada',
  CHF: 'Switzerland',
  NZD: 'New Zealand',
  CNY: 'China',
};

const CURRENCY_AFFECTED_PAIRS: Record<string, AffectedPairMapping[]> = {
  USD: [
    {
      symbol: 'XAU/USD',
      relationship: 'Inverse USD & US10Y Real-Yield Proxy',
      bullishCurrencyEffect: 'DOWN',
    },
    {
      symbol: 'EUR/USD',
      relationship: 'Inverse USD · Highest FX Liquidity',
      bullishCurrencyEffect: 'DOWN',
    },
    {
      symbol: 'GBP/USD',
      relationship: 'Inverse USD · High Intraday Volatility',
      bullishCurrencyEffect: 'DOWN',
    },
    {
      symbol: 'USD/JPY',
      relationship: 'Direct USD · High-Beta Yield Spread',
      bullishCurrencyEffect: 'UP',
    },
    {
      symbol: 'BTC/USD',
      relationship: 'Macro USD Liquidity & Risk Sentiment',
      bullishCurrencyEffect: 'DOWN',
    },
  ],
  EUR: [
    {
      symbol: 'EUR/USD',
      relationship: 'Direct EUR · Primary Dollar Major',
      bullishCurrencyEffect: 'UP',
    },
    {
      symbol: 'EUR/GBP',
      relationship: 'Direct EUR · European Cross Rate',
      bullishCurrencyEffect: 'UP',
    },
    {
      symbol: 'EUR/JPY',
      relationship: 'Direct EUR · Global Yield Cross',
      bullishCurrencyEffect: 'UP',
    },
    {
      symbol: 'EUR/AUD',
      relationship: 'Direct EUR · High-Range Momentum Cross',
      bullishCurrencyEffect: 'UP',
    },
  ],
  GBP: [
    {
      symbol: 'GBP/USD',
      relationship: 'Direct GBP · London Killzone Leader',
      bullishCurrencyEffect: 'UP',
    },
    {
      symbol: 'GBP/JPY',
      relationship: 'Direct GBP · High-Beta Volatility Cross',
      bullishCurrencyEffect: 'UP',
    },
    {
      symbol: 'EUR/GBP',
      relationship: 'Inverse GBP · UK-EZ Policy Spread',
      bullishCurrencyEffect: 'DOWN',
    },
    {
      symbol: 'GBP/AUD',
      relationship: 'Direct GBP · Wide-ATR Swing Cross',
      bullishCurrencyEffect: 'UP',
    },
  ],
  JPY: [
    {
      symbol: 'USD/JPY',
      relationship: 'Inverse JPY · BoJ-Fed Yield Anchor',
      bullishCurrencyEffect: 'DOWN',
    },
    {
      symbol: 'GBP/JPY',
      relationship: 'Inverse JPY · High-Beta Carry Unwind',
      bullishCurrencyEffect: 'DOWN',
    },
    {
      symbol: 'EUR/JPY',
      relationship: 'Inverse JPY · Euro-Yen Carry Pair',
      bullishCurrencyEffect: 'DOWN',
    },
    {
      symbol: 'AUD/JPY',
      relationship: 'Inverse JPY · Global Risk Barometer',
      bullishCurrencyEffect: 'DOWN',
    },
  ],
  AUD: [
    {
      symbol: 'AUD/USD',
      relationship: 'Direct AUD · Asia-Pacific Commodity Major',
      bullishCurrencyEffect: 'UP',
    },
    {
      symbol: 'AUD/JPY',
      relationship: 'Direct AUD · Risk-On Carry Proxy',
      bullishCurrencyEffect: 'UP',
    },
    {
      symbol: 'EUR/AUD',
      relationship: 'Inverse AUD · EZ-Australia Spread',
      bullishCurrencyEffect: 'DOWN',
    },
    {
      symbol: 'GBP/AUD',
      relationship: 'Inverse AUD · UK-Australia Spread',
      bullishCurrencyEffect: 'DOWN',
    },
  ],
  CAD: [
    {
      symbol: 'USD/CAD',
      relationship: 'Inverse CAD · North American Session Pair',
      bullishCurrencyEffect: 'DOWN',
    },
    {
      symbol: 'WTI/USD',
      relationship: 'Canadian Energy Terms-of-Trade Link',
      bullishCurrencyEffect: 'UP',
    },
  ],
  CHF: [
    {
      symbol: 'USD/CHF',
      relationship: 'Inverse CHF · European Safe-Haven Major',
      bullishCurrencyEffect: 'DOWN',
    },
    {
      symbol: 'CHF/JPY',
      relationship: 'Direct CHF · Dual Safe-Haven Cross',
      bullishCurrencyEffect: 'UP',
    },
  ],
  NZD: [
    {
      symbol: 'NZD/USD',
      relationship: 'Direct NZD · Pacific Commodity Major',
      bullishCurrencyEffect: 'UP',
    },
    {
      symbol: 'AUD/USD',
      relationship: 'Sympathy Antipodean Rate Flow',
      bullishCurrencyEffect: 'UP',
    },
  ],
  CNY: [
    {
      symbol: 'AUD/USD',
      relationship: 'China Trade & Commodity Demand Proxy',
      bullishCurrencyEffect: 'UP',
    },
    {
      symbol: 'XAU/USD',
      relationship: 'Asian Physical & Macro Demand Sensitivity',
      bullishCurrencyEffect: 'UP',
    },
  ],
};

export function getAffectedPairsForCurrency(currency: string): AffectedPairMapping[] {
  const ccy = currency.trim().toUpperCase();
  return CURRENCY_AFFECTED_PAIRS[ccy] || CURRENCY_AFFECTED_PAIRS.USD;
}

/**
 * Indicators where a LOWER actual reading than forecast is stronger/bullish for the currency.
 */
export function isInversePolarityIndicator(title: string): boolean {
  const lower = title.toLowerCase();
  return (
    lower.includes('unemployment') ||
    lower.includes('jobless claims') ||
    lower.includes('claimant count') ||
    lower.includes('underemployment')
  );
}

interface ParsedMetricValue {
  num: number;
  suffix: string;
}

function parseReleaseNumber(raw: string): ParsedMetricValue | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '—' || trimmed === '-') return null;
  const match = trimmed.match(/^[$€£¥]?([+-]?\d+(?:,\d{3})*(?:\.\d+)?)\s*([%KMBTkmbt]*)$/);
  if (!match) return null;
  const num = Number.parseFloat(match[1].replace(/,/g, ''));
  if (!Number.isFinite(num)) return null;
  return {
    num,
    suffix: (match[2] || '').toUpperCase(),
  };
}

export function computeReleaseSurprise(
  title: string,
  currency: string,
  impact: NewsImpactTier,
  actualRaw: string,
  forecastRaw: string
): {
  surpriseDirection: NewsSurpriseDirection;
  surpriseLabel: string;
  surpriseDeltaText: string;
} {
  if (impact === 'Holiday') {
    return {
      surpriseDirection: 'pending',
      surpriseLabel: 'Bank Holiday · Thin Liquidity',
      surpriseDeltaText: 'Local interbank desk holiday',
    };
  }

  const act = parseReleaseNumber(actualRaw);
  const fcst = parseReleaseNumber(forecastRaw);

  if (!actualRaw || !actualRaw.trim()) {
    return {
      surpriseDirection: 'pending',
      surpriseLabel: 'Awaiting Release',
      surpriseDeltaText: forecastRaw
        ? `Consensus ${forecastRaw}`
        : 'Statement / Unscheduled Print',
    };
  }

  if (!act || !fcst) {
    return {
      surpriseDirection: 'inline',
      surpriseLabel: 'Released Print',
      surpriseDeltaText: `Actual ${actualRaw}`,
    };
  }

  const rawDiff = act.num - fcst.num;
  const absDiff = Math.abs(rawDiff);
  if (absDiff < 1e-6) {
    return {
      surpriseDirection: 'inline',
      surpriseLabel: `In-Line (${currency} Neutral)`,
      surpriseDeltaText: `Matched ${forecastRaw} consensus`,
    };
  }

  const inverse = isInversePolarityIndicator(title);
  const isCurrencyBullish = inverse ? rawDiff < 0 : rawDiff > 0;
  const decimals =
    actualRaw.includes('.') || forecastRaw.includes('.')
      ? Math.min(
          2,
          Math.max(
            actualRaw.split('.')[1]?.replace(/[^0-9]/g, '').length || 1,
            forecastRaw.split('.')[1]?.replace(/[^0-9]/g, '').length || 1
          )
        )
      : 0;

  const sign = rawDiff > 0 ? '+' : '';
  const suffix = act.suffix || fcst.suffix || '';
  const deltaStr = `${sign}${rawDiff.toFixed(decimals)}${suffix} vs Fcst`;

  return {
    surpriseDirection: isCurrencyBullish ? 'bullish' : 'bearish',
    surpriseLabel: isCurrencyBullish
      ? `Bullish ${currency} Beat`
      : `Bearish ${currency} Miss`,
    surpriseDeltaText: deltaStr,
  };
}

interface IndicatorKnowledgeSpec {
  officialOverview: string;
  usualEffect: string;
  whyTradersCare: string;
  sourceAgency: string;
  frequency: string;
  killzoneGuidance: string;
}

const DEFAULT_CENTRAL_BANK: Record<string, string> = {
  USD: 'Federal Reserve / U.S. Statistical Agencies',
  EUR: 'European Central Bank / Eurostat',
  GBP: 'Bank of England / UK Office for National Statistics',
  JPY: 'Bank of Japan / Statistics Bureau of Japan',
  AUD: 'Reserve Bank of Australia / Australian Bureau of Statistics',
  CAD: 'Bank of Canada / Statistics Canada',
  CHF: 'Swiss National Bank / Federal Statistical Office',
  NZD: 'Reserve Bank of New Zealand / Stats NZ',
};

export function resolveIndicatorKnowledge(
  title: string,
  currency: string,
  impact: NewsImpactTier,
  liveComment?: string,
  liveSource?: string
): IndicatorKnowledgeSpec {
  const ccy = currency.toUpperCase();
  const lower = title.toLowerCase();
  const goldClause =
    ccy === 'USD'
      ? ' (and inversely pressures XAU/USD & EUR/USD via higher real yields)'
      : '';

  if (impact === 'Holiday' || lower.includes('holiday')) {
    return {
      officialOverview:
        liveComment ||
        `Commercial banks and institutional liquidity desks in ${
          CURRENCY_COUNTRY_NAME[ccy] || ccy
        } are closed in observance of a national bank holiday.`,
      usualEffect: `Thinner ${ccy} order-book depth during local session hours; trend continuation often pauses until overlapping London or New York liquidity arrives.`,
      whyTradersCare:
        'Reduced interbank participation compresses range expansion during local hours while making thin-book stop sweeps around equal highs and lows easier to engineer.',
      sourceAgency: liveSource || `${CURRENCY_COUNTRY_NAME[ccy] || ccy} Banking Exchange`,
      frequency: 'Scheduled Annual Bank Holiday',
      killzoneGuidance:
        'Avoid mid-range breakout entries during the closed local session; demand a clean London/NY session CRT liquidity purge before executing.',
    };
  }

  if (
    lower.includes('cpi') ||
    lower.includes('pce') ||
    lower.includes('inflation') ||
    lower.includes('trimmed mean')
  ) {
    return {
      officialOverview:
        liveComment ||
        `Measures the rate of price change in consumer goods and services purchased by households in ${
          CURRENCY_COUNTRY_NAME[ccy] || ccy
        }, serving as the primary inflation gauge for central bank policy.`,
      usualEffect: `'Actual' greater than 'Forecast' is bullish for ${ccy}${goldClause}, as sticky inflation forces hawkish rate expectations.`,
      whyTradersCare:
        'Consumer inflation directly dictates central bank rate hikes or cuts. Even a 0.1% surprise in Core or Headline CPI reprices sovereign bond yields within seconds.',
      sourceAgency: liveSource || DEFAULT_CENTRAL_BANK[ccy] || 'National Statistics Office',
      frequency: ccy === 'AUD' || ccy === 'NZD' ? 'Monthly / Quarterly' : 'Monthly',
      killzoneGuidance:
        'High whipsaw alert (±15m around release): algorithms routinely sweep both sides of the pre-CPI M5 range before establishing the true H1 trend.',
    };
  }

  if (lower.includes('ppi') || lower.includes('producer price')) {
    return {
      officialOverview:
        liveComment ||
        'Tracks the average change over time in selling prices received by domestic producers for their output—a leading pipeline indicator for consumer inflation.',
      usualEffect: `'Actual' greater than 'Forecast' is bullish for ${ccy}${goldClause}.`,
      whyTradersCare:
        'When producers pay more for inputs and wholesale goods, those costs pass through to future CPI readings, shifting central bank rate path probabilities.',
      sourceAgency: liveSource || DEFAULT_CENTRAL_BANK[ccy] || 'National Statistics Office',
      frequency: 'Monthly',
      killzoneGuidance:
        'Watch for M5 Judas swings during the first 5 minutes post-release; confirm direction against H1 structure and US10Y yield flow.',
    };
  }

  if (
    lower.includes('non-farm') ||
    lower.includes('nonfarm') ||
    lower.includes('employment change') ||
    lower.includes('adp') ||
    lower.includes('payroll')
  ) {
    return {
      officialOverview:
        liveComment ||
        `Measures the net change in the number of employed people during the previous month in ${
          CURRENCY_COUNTRY_NAME[ccy] || ccy
        }, excluding farming.`,
      usualEffect: `'Actual' greater than 'Forecast' is bullish for ${ccy}${goldClause}, signaling robust labor demand and consumer spending power.`,
      whyTradersCare:
        'Job creation is the single fastest-moving monthly barometer of economic expansion and directly anchors central bank employment mandates.',
      sourceAgency: liveSource || DEFAULT_CENTRAL_BANK[ccy] || 'Labor Statistics Agency',
      frequency: 'Monthly (First week of month)',
      killzoneGuidance:
        'Extreme spread widening from -2m to +10m. Evaluate headline payrolls alongside Unemployment Rate and Wage Growth—mixed sub-components often create a sweep-and-reverse CRT candle.',
    };
  }

  if (
    lower.includes('unemployment') ||
    lower.includes('jobless claims') ||
    lower.includes('claimant')
  ) {
    return {
      officialOverview:
        liveComment ||
        'Measures the percentage of the total workforce (or weekly claimants) actively seeking employment during the reporting period.',
      usualEffect: `'Actual' LESS than 'Forecast' is bullish for ${ccy}${goldClause} (inverse indicator: tighter labor market = hawkish rate support).`,
      whyTradersCare:
        'Rising unemployment is one of the earliest triggers for emergency central bank rate cuts, making labor slack data a major sovereign yield mover.',
      sourceAgency: liveSource || DEFAULT_CENTRAL_BANK[ccy] || 'Department of Labor',
      frequency: lower.includes('claims') ? 'Weekly' : 'Monthly',
      killzoneGuidance:
        'Remember inverse polarity: a lower print strengthens the currency. Wait for the first M5 candle close + FVG formation before entering.',
    };
  }

  if (
    lower.includes('average hourly earnings') ||
    lower.includes('wage') ||
    lower.includes('earnings') ||
    lower.includes('employment cost')
  ) {
    return {
      officialOverview:
        liveComment ||
        'Measures month-over-month or year-over-year growth in wages and compensation paid to workers—the core driver of service-sector inflation.',
      usualEffect: `'Actual' greater than 'Forecast' is bullish for ${ccy}${goldClause}.`,
      whyTradersCare:
        'Sustained wage growth fuels sticky domestic demand inflation, preventing central banks from cutting interest rates prematurely.',
      sourceAgency: liveSource || DEFAULT_CENTRAL_BANK[ccy] || 'Labor Statistics Office',
      frequency: 'Monthly / Quarterly',
      killzoneGuidance:
        'Often released simultaneously with Payrolls & Unemployment; check whether wage growth confirms or contradicts the headline jobs print.',
    };
  }

  if (
    lower.includes('rate') &&
    (lower.includes('federal funds') ||
      lower.includes('official bank') ||
      lower.includes('cash rate') ||
      lower.includes('overnight') ||
      lower.includes('refinancing') ||
      lower.includes('policy rate') ||
      lower.includes('interest rate') ||
      lower.includes('snb') ||
      lower.includes('boj'))
  ) {
    return {
      officialOverview:
        liveComment ||
        `The benchmark short-term overnight interest rate set by ${
          DEFAULT_CENTRAL_BANK[ccy]?.split('/')[0]?.trim() || ccy
        } monetary policymakers.`,
      usualEffect: `'Actual' greater than 'Forecast' (or hawkish forward guidance) is strongly bullish for ${ccy}${goldClause}.`,
      whyTradersCare:
        'Short-term interest rates are the foundational valuation anchor of global foreign exchange carry and capital flows.',
      sourceAgency: liveSource || DEFAULT_CENTRAL_BANK[ccy] || 'Central Bank',
      frequency: '8 scheduled policy meetings per year',
      killzoneGuidance:
        'Two-stage volatility event: Stage 1 hits on the rate print/statement, Stage 2 hits 30 minutes later during the Governor press conference—do not get trapped on the Stage 1 wick.',
    };
  }

  if (
    lower.includes('fomc') ||
    lower.includes('monetary policy') ||
    lower.includes('press conference') ||
    lower.includes('minutes') ||
    lower.includes('speaks') ||
    lower.includes('testifies') ||
    lower.includes('powell') ||
    lower.includes('lagarde') ||
    lower.includes('bailey') ||
    lower.includes('ueda')
  ) {
    return {
      officialOverview:
        liveComment ||
        `Official central bank policy communication, voting committee minutes, or live testimony delivering forward guidance on future ${ccy} interest rate adjustments.`,
      usualEffect: `More hawkish commentary than priced in is bullish for ${ccy}${goldClause}; dovish pivot hints trigger immediate ${ccy} repricing lower.`,
      whyTradersCare:
        'Markets price the future path of interest rates rather than past decisions; subtle phrasing shifts during Q&A frequently reverse entire weekly trends.',
      sourceAgency: liveSource || DEFAULT_CENTRAL_BANK[ccy] || 'Central Bank',
      frequency: 'Scheduled Policy Calendar',
      killzoneGuidance:
        'Algorithmic headline scanners react to individual sentences during live Q&A—keep stop-losses outside H1 structural extremes or stand aside until the speech concludes.',
    };
  }

  if (lower.includes('gdp') || lower.includes('gross domestic')) {
    return {
      officialOverview:
        liveComment ||
        `Measures the annualized or quarterly change in the inflation-adjusted value of all goods and services produced by the ${
          CURRENCY_COUNTRY_NAME[ccy] || ccy
        } economy.`,
      usualEffect: `'Actual' greater than 'Forecast' is bullish for ${ccy}${goldClause}.`,
      whyTradersCare:
        'GDP is the broadest scorecard of overall economic health, separating expansionary regimes from recessionary contractions.',
      sourceAgency: liveSource || DEFAULT_CENTRAL_BANK[ccy] || 'National Accounts Bureau',
      frequency: 'Quarterly (Advance, Preliminary & Final)',
      killzoneGuidance:
        'Advance/Preliminary GDP releases carry the largest surprise impact; confirm post-release follow-through with H1 Order Block / FVG displacement.',
    };
  }

  if (lower.includes('pmi') || lower.includes('ism') || lower.includes('empire state') || lower.includes('philly fed')) {
    return {
      officialOverview:
        liveComment ||
        'Diffusion index surveying purchasing executives on new orders, production, employment, supplier deliveries, and inventories (readings above 50.0 indicate expansion; below 50.0 indicate contraction).',
      usualEffect: `'Actual' greater than 'Forecast' (especially crossing above 50.0) is bullish for ${ccy}${goldClause}.`,
      whyTradersCare:
        'Purchasing Managers Indices are released before official government data each month, giving institutional desks the earliest real-time read on economic momentum and prices-paid inflation.',
      sourceAgency: liveSource || 'S&P Global / Institute for Supply Management (ISM)',
      frequency: 'Monthly (Flash & Final)',
      killzoneGuidance:
        'High directional follow-through catalyst when Services/Manufacturing PMI crosses the 50.0 boom-bust line—look for an M5 pullback into the release FVG.',
    };
  }

  if (
    lower.includes('retail sales') ||
    lower.includes('durable goods') ||
    lower.includes('consumer confidence') ||
    lower.includes('consumer sentiment') ||
    lower.includes('uoj') ||
    lower.includes('michigan')
  ) {
    return {
      officialOverview:
        liveComment ||
        `Tracks household consumption appetite, big-ticket manufacturing orders, or consumer financial optimism across ${
          CURRENCY_COUNTRY_NAME[ccy] || ccy
        }.`,
      usualEffect: `'Actual' greater than 'Forecast' is bullish for ${ccy}${goldClause}.`,
      whyTradersCare:
        'Consumer spending drives over 60–70% of developed-market GDP; resilient retail demand keeps growth and interest-rate expectations elevated.',
      sourceAgency: liveSource || DEFAULT_CENTRAL_BANK[ccy] || 'Census / Economic Research Bureau',
      frequency: 'Monthly',
      killzoneGuidance:
        'Monitor the first 10 minutes post-print for a stop-run of pre-news Asian/London session highs or lows before joining aligned H1 structure.',
    };
  }

  return {
    officialOverview:
      liveComment ||
      `Scheduled ${impact.toLowerCase()}-impact macroeconomic release for ${
        CURRENCY_COUNTRY_NAME[ccy] || ccy
      } (${ccy}) monitored by institutional FX and rates desks.`,
    usualEffect: `'Actual' stronger than consensus forecast typically supports ${ccy}${goldClause}, while weaker prints weigh on ${ccy} yield differentials.`,
    whyTradersCare:
      'Deviations from institutional consensus shift short-term rate differentials and trigger liquidity sweeps around nearby intraday highs and lows.',
    sourceAgency: liveSource || DEFAULT_CENTRAL_BANK[ccy] || 'Official Statistical Release',
    frequency: 'Scheduled Macro Calendar',
    killzoneGuidance:
      'Allow initial release spread widening (±5–15m) to settle and confirm an M5 structure break in alignment with H1 bias before executing.',
  };
}

export function resolveEffectiveTimezone(tzOption: string): string {
  if (!tzOption || tzOption === 'LOCAL') {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }
  return tzOption;
}

export function formatEventTimeInZone(
  timestampUtcMs: number,
  isAllDayOrTentative: boolean,
  rawTimeLabel: string,
  tzOption: string
): string {
  if (isAllDayOrTentative || timestampUtcMs <= 0) {
    return rawTimeLabel || 'All Day';
  }
  const zone = resolveEffectiveTimezone(tzOption);
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(timestampUtcMs));
  } catch {
    return rawTimeLabel || 'Scheduled';
  }
}

export function formatEventDateKeyInZone(
  timestampUtcMs: number,
  tzOption: string
): string {
  const zone = resolveEffectiveTimezone(tzOption);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(timestampUtcMs));
    const y = parts.find((p) => p.type === 'year')?.value || '2026';
    const m = parts.find((p) => p.type === 'month')?.value || '01';
    const d = parts.find((p) => p.type === 'day')?.value || '01';
    return `${y}-${m}-${d}`;
  } catch {
    return new Date(timestampUtcMs).toISOString().slice(0, 10);
  }
}

export function formatDayHeadingInZone(
  timestampUtcMs: number,
  tzOption: string
): string {
  const zone = resolveEffectiveTimezone(tzOption);
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }).format(new Date(timestampUtcMs));
  } catch {
    return new Date(timestampUtcMs).toDateString();
  }
}

export function formatShortWeekdayDateInZone(
  timestampUtcMs: number,
  tzOption: string
): string {
  const zone = resolveEffectiveTimezone(tzOption);
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(new Date(timestampUtcMs));
  } catch {
    return new Date(timestampUtcMs).toDateString();
  }
}

export function formatFullDateTimeInZone(
  timestampUtcMs: number,
  isAllDayOrTentative: boolean,
  rawTimeLabel: string,
  tzOption: string
): string {
  const zone = resolveEffectiveTimezone(tzOption);
  const datePart = formatDayHeadingInZone(timestampUtcMs, zone);
  if (isAllDayOrTentative) {
    return `${datePart} · ${rawTimeLabel || 'All Day'}`;
  }
  try {
    const timePart = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    }).format(new Date(timestampUtcMs));
    return `${datePart} · ${timePart}`;
  } catch {
    return `${datePart} · ${rawTimeLabel}`;
  }
}

export function formatRelativeCountdown(
  timestampUtcMs: number,
  nowMs: number,
  isAllDayOrTentative: boolean
): { text: string; isImminent: boolean; isPast: boolean } {
  if (isAllDayOrTentative) {
    return { text: 'All Day', isImminent: false, isPast: false };
  }
  const diffMs = timestampUtcMs - nowMs;
  if (diffMs < -60_000) {
    const agoMin = Math.round(Math.abs(diffMs) / 60_000);
    if (agoMin < 60) {
      return { text: `${agoMin}m ago`, isImminent: false, isPast: true };
    }
    const agoHrs = Math.floor(agoMin / 60);
    if (agoHrs < 24) {
      return { text: `${agoHrs}h ago`, isImminent: false, isPast: true };
    }
    const agoDays = Math.floor(agoHrs / 24);
    return { text: `${agoDays}d ago`, isImminent: false, isPast: true };
  }

  if (diffMs <= 60_000) {
    return { text: 'Releasing Now', isImminent: true, isPast: false };
  }

  const totalMin = Math.ceil(diffMs / 60_000);
  if (totalMin < 60) {
    return {
      text: `in ${totalMin}m`,
      isImminent: totalMin <= 30,
      isPast: false,
    };
  }

  const hrs = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;
  if (hrs < 24) {
    return {
      text: remMin > 0 ? `in ${hrs}h ${remMin}m` : `in ${hrs}h`,
      isImminent: false,
      isPast: false,
    };
  }

  const days = Math.floor(hrs / 24);
  const remHrs = hrs % 24;
  return {
    text: remHrs > 0 ? `in ${days}d ${remHrs}h` : `in ${days}d`,
    isImminent: false,
    isPast: false,
  };
}
