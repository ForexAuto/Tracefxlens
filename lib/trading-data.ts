export type AssetCategory = 'Forex' | 'Commodities' | 'Crypto';

export interface MarketPair {
  symbol: string;
  name: string;
  category: AssetCategory;
  decimals: number;
}

export interface TimeframeOption {
  value: string;
  label: string;
  style: string;
}

export type SignalType = 'BUY' | 'SELL' | 'HOLD';

export type AnalysisMode = 'single' | 'top_down_crt';

export type CrtMacroBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface CrtTopDownContext {
  macroTimeframe: string;
  executionTimeframe: string;
  h1CrtValid: boolean;
  h1Bias: CrtMacroBias;
  crtRangeHigh?: string;
  crtRangeLow?: string;
  crtEquilibrium?: string;
  crtSweepStatus: string;
  m5ExecutionTrigger: string;
  alignmentVerdict: string;
}

export type ExecutionCategory = 'Market Execution' | 'Stand Aside';

export type ZoneRole =
  | 'Support'
  | 'Resistance'
  | 'Supply Zone'
  | 'Demand Zone'
  | 'Bullish OB'
  | 'Bearish OB'
  | 'Fair Value Gap'
  | 'Liquidity'
  | 'Structure Break';

export interface KeyPriceLevel {
  label: string;
  price: string;
  role: ZoneRole;
}

export interface ChartPlotBox {
  /** Left edge of main candlestick plot area in [0..1000] normalized X */
  leftX: number;
  /** Right edge of main candlestick plot area (before Y-axis labels) in [0..1000] normalized X */
  rightX: number;
  /** Top edge of main candlestick plot area in [0..1000] normalized Y */
  topY: number;
  /** Bottom edge of main candlestick plot area (above sub-indicators/time axis) in [0..1000] normalized Y */
  bottomY: number;
}

export interface ChartAxisTick {
  tickId?: string;
  price: string;
  y: number;
}

export interface ChartAxisCalibration {
  highRefPrice?: string;
  highRefY?: number;
  lowRefPrice?: string;
  lowRefY?: number;
  axisTicks?: ChartAxisTick[];
  lastCandleX: number;
  lastCandleY: number;
}

export interface ChartMarkupZone {
  label: string;
  role:
    | 'Support'
    | 'Resistance'
    | 'Supply Zone'
    | 'Demand Zone'
    | 'Bullish OB'
    | 'Bearish OB'
    | 'Liquidity';
  startX: number;
  endX?: number;
  topY: number;
  bottomY: number;
  topPrice?: string;
  bottomPrice?: string;
  mitigated?: boolean;
  isPrimary?: boolean;
}

export interface ChartMarkupFvg {
  gapId?: string;
  label: string;
  tone: 'bullish' | 'bearish';
  startX: number;
  endX?: number;
  topY: number;
  bottomY: number;
  topPrice?: string;
  bottomPrice?: string;
  mitigated?: boolean;
  isPrimary?: boolean;
}

export interface ChartMarkupStructureBreak {
  pivotId?: string;
  kind: 'BOS' | 'CHoCH';
  label?: string;
  tone: 'bullish' | 'bearish';
  startX: number;
  endX: number;
  y: number;
  price?: string;
  isPrimary?: boolean;
}

export interface ChartMarkupLiquidity {
  pivotId?: string;
  kind: 'EQH' | 'EQL' | 'BSL' | 'SSL' | 'Sweep';
  label: string;
  tone: 'bullish' | 'bearish' | 'neutral';
  startX: number;
  endX: number;
  y: number;
  price?: string;
  swept?: boolean;
  isPrimary?: boolean;
}

export interface ChartMarkupTrendline {
  label: string;
  role?: 'Trendline' | 'Channel Upper' | 'Channel Lower';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  style: 'solid' | 'dashed';
  tone: 'bullish' | 'bearish' | 'neutral';
  isPrimary?: boolean;
}

export interface ChartMarkupSwing {
  pivotId?: string;
  tag: string;
  x: number;
  y: number;
  position: 'above' | 'below';
  tone: 'bullish' | 'bearish' | 'neutral';
  price?: string;
  isPrimary?: boolean;
}

export interface ChartMarkupData {
  plotBox: ChartPlotBox;
  axisCalibration: ChartAxisCalibration;
  zones: ChartMarkupZone[];
  fairValueGaps?: ChartMarkupFvg[];
  structureBreaks?: ChartMarkupStructureBreak[];
  liquidityLevels?: ChartMarkupLiquidity[];
  trendlines: ChartMarkupTrendline[];
  swings: ChartMarkupSwing[];
}

export type AnalysisStageStatus =
  | 'locked'
  | 'active'
  | 'approved'
  | 'completed'
  | 'rejected'
  | 'stopped';

export interface AnalysisStageItem {
  step: number;
  title: string;
  waitingText: string;
  finding: string | null;
  status: AnalysisStageStatus;
}

export interface DetectedPlotBounds {
  leftX: number;
  rightX: number;
  topY: number;
  bottomY: number;
}

export interface DetectedAxisTickAnchor {
  id: string;
  y: number;
  isLiveBadge?: boolean;
}

export interface DetectedCandleBar {
  index: number;
  x: number;
  width: number;
  highY: number;
  lowY: number;
  bodyTopY: number;
  bodyBottomY: number;
  polarity: 'bullish' | 'bearish' | 'neutral';
}

export interface DetectedPivotAnchor {
  id: string;
  kind: 'high' | 'low';
  x: number;
  y: number;
  candleIndex: number;
}

export interface DetectedFvgCandidate {
  id: string;
  tone: 'bullish' | 'bearish';
  startX: number;
  topY: number;
  bottomY: number;
  mitigatedEndX?: number;
}

export interface DetectedCandleEnvelope {
  candleCount: number;
  firstCandleX: number;
  lastCandleX: number;
  lastCandleCloseY: number;
  minHighY: number;
  maxLowY: number;
}

export interface VisionEnhancementPayload {
  rulerGridDataUrl?: string;
  rightEdgeZoomDataUrl?: string;
  detectedPlotBox?: DetectedPlotBounds;
  subPaneCount?: number;
  subPaneDividerYs?: number[];
  isLightBg?: boolean;
  detectedAxisTicks?: DetectedAxisTickAnchor[];
  liveBadgeY?: number | null;
  detectedPivots?: DetectedPivotAnchor[];
  detectedFvgCandidates?: DetectedFvgCandidate[];
  candleEnvelope?: DetectedCandleEnvelope;
}

export type OhlcVerificationMode = 'live_spot' | 'atr_spot_only' | 'disabled';

export type MacroSensitivityProfile =
  | 'inverse_usd'
  | 'direct_usd'
  | 'gold_real_yield'
  | 'jpy_yield_carry'
  | 'risk_liquidity'
  | 'usd_neutral_cross';

export type MacroSignalAlignment = 'tailwind' | 'headwind' | 'mixed' | 'neutral';

export interface MacroInstrumentSnapshot {
  symbol: 'DXY' | 'US10Y';
  value: string;
  changeLabel: string;
  h1Bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'RISING' | 'FALLING' | 'FLAT';
  m5Impulse: 'UP' | 'DOWN' | 'FLAT';
  sessionHigh?: string;
  sessionLow?: string;
  ageSeconds: number;
  source: string;
}

export interface MacroCorrelationContext {
  dxy: MacroInstrumentSnapshot | null;
  us10y: MacroInstrumentSnapshot | null;
  sensitivityProfile: MacroSensitivityProfile;
  sensitivityLabel: string;
  pairImpliedBias: CrtMacroBias;
  signalAlignment: MacroSignalAlignment;
  alignmentLabel: string;
  summary: string;
}

export interface VisionVerificationMeta {
  rulerCalibrated?: boolean;
  rightEdgeZoomed?: boolean;
  subPanesDetected?: number;
  ohlcSynced?: boolean;
  ohlcMode?: OhlcVerificationMode;
  ohlcAgeSeconds?: number;
  ohlcSource?: string;
  ohlcAtr?: string;
  macroSynced?: boolean;
  selfChecked?: boolean;
  selfCheckSummary?: string;
}

export interface TradingSignalResponse {
  isValidChart: boolean;
  validationMessage?: string;
  analysisMode?: AnalysisMode;
  crtContext?: CrtTopDownContext;
  macroContext?: MacroCorrelationContext;
  signalType: SignalType;
  executionCategory: ExecutionCategory;
  detectedPair: string;
  detectedTimeframe: string;
  currentMarketPrice: string;
  entryPrice: string;
  entryTriggerNote: string;
  stopLoss: string;
  takeProfit1: string;
  takeProfit2: string;
  takeProfit3: string;
  riskRewardRatio: string;
  marketStructure: string;
  confidenceSummary: string;
  technicalRationale: string[];
  keyLevels: KeyPriceLevel[];
  invalidationCondition: string;
  chartMarkup?: ChartMarkupData;
  macroChartMarkup?: ChartMarkupData;
  visionVerification?: VisionVerificationMeta;
  auditTrail?: Array<{
    step: number;
    title: string;
    finding: string;
  }>;
}

export type TradeOutcome = 'WON' | 'LOST';

export interface SignalHistoryRecord {
  id: string;
  fingerprint: string;
  pair: string;
  timeframe: string;
  analysisMode?: AnalysisMode;
  crtContext?: CrtTopDownContext;
  macroContext?: MacroCorrelationContext;
  signalType: SignalType;
  executionCategory: ExecutionCategory;
  currentMarketPrice: string;
  entryPrice: string;
  stopLoss: string;
  takeProfit1: string;
  takeProfit2: string;
  takeProfit3: string;
  riskRewardRatio: string;
  marketStructure: string;
  confidenceSummary: string;
  entryTriggerNote: string;
  invalidationCondition: string;
  technicalRationale: string[];
  keyLevels: KeyPriceLevel[];
  chartMarkup?: ChartMarkupData;
  chartImageUrl: string | null;
  outcome: TradeOutcome | null;
  outcomeLockedAt: string | null;
  createdAt: string;
}

export type AnalyzeStreamEvent =
  | {
      event: 'approval';
      approved: boolean;
      detectedPair?: string;
      detectedTimeframe?: string;
      finding: string;
    }
  | {
      event: 'step';
      step: number;
      finding: string;
    }
  | {
      event: 'result';
      data: TradingSignalResponse;
    }
  | {
      event: 'status';
      message: string;
    }
  | {
      event: 'error';
      message: string;
    };

export function createInitialAnalysisStages(
  pair: string,
  timeframe: string,
  analysisMode: AnalysisMode = 'single'
): AnalysisStageItem[] {
  if (analysisMode === 'top_down_crt') {
    return [
      {
        step: 1,
        title: 'H1 & M5 Chart Verification & Axis Calibration',
        waitingText: `Verifying both H1 macro and M5 execution ${pair} charts & calibrating axes...`,
        finding: null,
        status: 'active',
      },
      {
        step: 2,
        title: 'H1 Macro CRT Range, Purge & Bias Audit',
        waitingText: 'Locked until both H1 and M5 charts are approved',
        finding: null,
        status: 'locked',
      },
      {
        step: 3,
        title: 'M5 Execution Structure, CHoCH & FVG Scan',
        waitingText: 'Locked until H1 CRT macro range & bias are mapped',
        finding: null,
        status: 'locked',
      },
      {
        step: 4,
        title: 'H1 Dominance Filter & Signal Veto Check',
        waitingText: 'Locked until M5 trigger alignment is checked against H1',
        finding: null,
        status: 'locked',
      },
      {
        step: 5,
        title: 'H1 Target Projection & M5 Tight Risk Validation',
        waitingText: 'Locked until H1 dominance & M5 risk compression pass',
        finding: null,
        status: 'locked',
      },
    ];
  }

  return [
    {
      step: 1,
      title: 'Chart Verification & Axis Calibration',
      waitingText: `Awaiting AI approval that uploaded image is a valid ${pair} price chart...`,
      finding: null,
      status: 'active',
    },
    {
      step: 2,
      title: `${timeframe} Market Structure Mapping`,
      waitingText: 'Locked until chart verification is approved',
      finding: null,
      status: 'locked',
    },
    {
      step: 3,
      title: 'Supply, Demand & Liquidity Scan',
      waitingText: 'Locked until market structure is mapped',
      finding: null,
      status: 'locked',
    },
    {
      step: 4,
      title: 'Directional Bias & Signal Classification',
      waitingText: 'Locked until key reaction zones are located',
      finding: null,
      status: 'locked',
    },
    {
      step: 5,
      title: 'Entry, Stop-Loss & TP1–TP3 Validation',
      waitingText: 'Locked until directional signal is classified',
      finding: null,
      status: 'locked',
    },
  ];
}

export const MARKET_PAIRS: MarketPair[] = [
  // Global Currencies (Forex Majors & Crosses)
  { symbol: 'EUR/USD', name: 'Euro / US Dollar', category: 'Forex', decimals: 5 },
  { symbol: 'GBP/USD', name: 'British Pound / US Dollar', category: 'Forex', decimals: 5 },
  { symbol: 'USD/JPY', name: 'US Dollar / Japanese Yen', category: 'Forex', decimals: 3 },
  { symbol: 'USD/CHF', name: 'US Dollar / Swiss Franc', category: 'Forex', decimals: 5 },
  { symbol: 'AUD/USD', name: 'Australian Dollar / US Dollar', category: 'Forex', decimals: 5 },
  { symbol: 'USD/CAD', name: 'US Dollar / Canadian Dollar', category: 'Forex', decimals: 5 },
  { symbol: 'NZD/USD', name: 'New Zealand Dollar / US Dollar', category: 'Forex', decimals: 5 },
  { symbol: 'EUR/GBP', name: 'Euro / British Pound', category: 'Forex', decimals: 5 },
  { symbol: 'EUR/JPY', name: 'Euro / Japanese Yen', category: 'Forex', decimals: 3 },
  { symbol: 'GBP/JPY', name: 'British Pound / Japanese Yen', category: 'Forex', decimals: 3 },
  { symbol: 'AUD/JPY', name: 'Australian Dollar / Japanese Yen', category: 'Forex', decimals: 3 },
  { symbol: 'CHF/JPY', name: 'Swiss Franc / Japanese Yen', category: 'Forex', decimals: 3 },
  { symbol: 'EUR/AUD', name: 'Euro / Australian Dollar', category: 'Forex', decimals: 5 },
  { symbol: 'GBP/AUD', name: 'British Pound / Australian Dollar', category: 'Forex', decimals: 5 },
  { symbol: 'USD/ZAR', name: 'US Dollar / South African Rand', category: 'Forex', decimals: 4 },
  { symbol: 'USD/MXN', name: 'US Dollar / Mexican Peso', category: 'Forex', decimals: 4 },

  // Commodities (Precious Metals & Energy)
  { symbol: 'XAU/USD', name: 'Gold Spot / US Dollar', category: 'Commodities', decimals: 2 },
  { symbol: 'XAG/USD', name: 'Silver Spot / US Dollar', category: 'Commodities', decimals: 3 },
  { symbol: 'WTI/USD', name: 'WTI Crude Oil / US Dollar', category: 'Commodities', decimals: 2 },
  { symbol: 'BRENT/USD', name: 'Brent Crude Oil / US Dollar', category: 'Commodities', decimals: 2 },
  { symbol: 'XPT/USD', name: 'Platinum Spot / US Dollar', category: 'Commodities', decimals: 2 },
  { symbol: 'NATGAS/USD', name: 'Henry Hub Natural Gas', category: 'Commodities', decimals: 3 },
  { symbol: 'XCU/USD', name: 'High Grade Copper', category: 'Commodities', decimals: 4 },

  // Cryptocurrencies
  { symbol: 'BTC/USD', name: 'Bitcoin / US Dollar', category: 'Crypto', decimals: 2 },
  { symbol: 'ETH/USD', name: 'Ethereum / US Dollar', category: 'Crypto', decimals: 2 },
  { symbol: 'SOL/USD', name: 'Solana / US Dollar', category: 'Crypto', decimals: 2 },
  { symbol: 'XRP/USD', name: 'Ripple / US Dollar', category: 'Crypto', decimals: 4 },
  { symbol: 'BNB/USD', name: 'BNB / US Dollar', category: 'Crypto', decimals: 2 },
  { symbol: 'ADA/USD', name: 'Cardano / US Dollar', category: 'Crypto', decimals: 4 },
  { symbol: 'AVAX/USD', name: 'Avalanche / US Dollar', category: 'Crypto', decimals: 2 },
  { symbol: 'LINK/USD', name: 'Chainlink / US Dollar', category: 'Crypto', decimals: 3 },
];

export const TIMEFRAMES: TimeframeOption[] = [
  { value: 'M1', label: '1 Minute', style: 'Scalping' },
  { value: 'M5', label: '5 Minutes', style: 'Scalping' },
  { value: 'M15', label: '15 Minutes', style: 'Intraday' },
  { value: 'M30', label: '30 Minutes', style: 'Intraday' },
  { value: 'H1', label: '1 Hour', style: 'Intraday / Swing' },
  { value: 'H4', label: '4 Hours', style: 'Swing' },
  { value: 'D1', label: 'Daily', style: 'Position' },
  { value: 'W1', label: 'Weekly', style: 'Macro' },
];
