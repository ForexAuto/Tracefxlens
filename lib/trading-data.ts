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

export type ExecutionCategory = 'Market Execution' | 'Stand Aside';

export interface KeyPriceLevel {
  label: string;
  price: string;
  role: 'Support' | 'Resistance' | 'Supply Zone' | 'Demand Zone' | 'Liquidity';
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
  role: 'Support' | 'Resistance' | 'Supply Zone' | 'Demand Zone' | 'Liquidity';
  startX: number;
  topY: number;
  bottomY: number;
  topPrice?: string;
  bottomPrice?: string;
}

export interface ChartMarkupTrendline {
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  style: 'solid' | 'dashed';
  tone: 'bullish' | 'bearish' | 'neutral';
}

export interface ChartMarkupSwing {
  tag: string;
  x: number;
  y: number;
  position: 'above' | 'below';
  tone: 'bullish' | 'bearish' | 'neutral';
}

export interface ChartMarkupData {
  plotBox: ChartPlotBox;
  axisCalibration: ChartAxisCalibration;
  zones: ChartMarkupZone[];
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

export interface TradingSignalResponse {
  isValidChart: boolean;
  validationMessage?: string;
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
  timeframe: string
): AnalysisStageItem[] {
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
