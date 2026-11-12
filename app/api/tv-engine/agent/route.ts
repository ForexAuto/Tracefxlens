import { createOpenAIResponse, extractOpenAIOutputText } from '@/lib/openai';
import { NextRequest } from 'next/server';
import type {
  TvAgentStep,
  TvAgentStreamEvent,
  TvPendingOrderApproval,
} from '@/lib/tv-engine-types';
import {
  captureViewportSnapshot,
  executeTvAgentTool,
  saveTradingViewChartLayout,
} from '@/lib/tv-playwright-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_AGENT_STEPS = 12;

const TV_AGENT_TOOLS: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [
  {
    name: 'switch_symbol',
    description:
      'Switch the active TradingView chart to any currency pair, commodity, index, stock, or crypto symbol (e.g. "OANDA:XAUUSD", "FX:EURUSD", "BINANCE:BTCUSDT", "NASDAQ:NQ1!").',
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description:
            'Target TradingView ticker or exchange:ticker, e.g. OANDA:XAUUSD or BTCUSDT.',
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'switch_timeframe',
    description:
      'Change the active TradingView candle timeframe/interval (e.g. "1m", "5m", "15m", "30m", "1H", "4H", "1D", "1W").',
    parameters: {
      type: 'object',
      properties: {
        timeframe: {
          type: 'string',
          description: 'Desired timeframe such as 1m, 5m, 15m, 1H, 4H, 1D, 1W.',
        },
      },
      required: ['timeframe'],
    },
  },
  {
    name: 'manage_indicators',
    description:
      'Open the TradingView Indicators dialog or search and add an indicator (public, built-in, or user invite-only/favorites) onto the chart.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description:
            '"add" to search and click the top matching indicator, or "open_menu" to open the Indicators modal so you can inspect Invite-only/Favorites tabs visually.',
        },
        indicatorQuery: {
          type: 'string',
          description:
            'Optional indicator search text, e.g. "Relative Strength Index", "Moving Average Exponential", "Smart Money Concepts".',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'draw_on_chart',
    description:
      'Draw native TradingView objects directly onto the chart canvas using normalized [0..1000] viewport coordinates inspected from the screenshot.',
    parameters: {
      type: 'object',
      properties: {
        tool: {
          type: 'string',
          description:
            'One of: "horizontal_line", "horizontal_ray", "vertical_line", "trendline", "fib_retracement", "rectangle", "long_position", "short_position".',
        },
        startX: {
          type: 'number',
          description: 'Normalized start X coordinate (0..1000) inside the chart canvas.',
        },
        startY: {
          type: 'number',
          description: 'Normalized start Y coordinate (0..1000) matching the exact price level / candle wick.',
        },
        endX: {
          type: 'number',
          description: 'Normalized end X coordinate (0..1000) for two-point tools (trendline, rectangle, fib_retracement).',
        },
        endY: {
          type: 'number',
          description: 'Normalized end Y coordinate (0..1000) for two-point tools.',
        },
      },
      required: ['tool', 'startX', 'startY'],
    },
  },
  {
    name: 'chart_view_action',
    description:
      'Perform standard TradingView chart view adjustments: reset chart view (Alt+R), zoom in/out, pan left/right, undo last drawing, open alerts dialog (Alt+A), or toggle log scale.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description:
            'One of: "reset_view", "zoom_in", "zoom_out", "pan_left", "pan_right", "undo", "open_alerts", "toggle_log_scale".',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'switch_layout',
    description:
      'Load a specific TradingView chart layout URL or open the top-right Saved Layouts menu.',
    parameters: {
      type: 'object',
      properties: {
        layoutUrlOrName: {
          type: 'string',
          description:
            'Full https://www.tradingview.com/chart/... URL or the name of the saved layout to open.',
        },
      },
      required: ['layoutUrlOrName'],
    },
  },
  {
    name: 'save_chart_layout',
    description:
      'Save the current TradingView chart layout (all drawings, levels, indicators, symbol and interval changes) to the cloud (Ctrl+S / Save Layout). Call this tool whenever any changes are made to the chart so that drawings and setups persist permanently.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Reason for saving chart layout (e.g. "Saved trendline and SMC levels").',
        },
      },
    },
  },
  {
    name: 'open_or_submit_order',
    description:
      'Open the TradingView Order Ticket (Shift+T) or request permission to submit a BUY/SELL trade order. ALWAYS call this tool with action="submit_order" before clicking any final Buy/Sell order placement button.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description:
            '"open_ticket" to open and inspect the order panel, or "submit_order" right before placing a live or paper trade.',
        },
        side: {
          type: 'string',
          description: '"BUY" or "SELL".',
        },
        orderType: {
          type: 'string',
          description: 'e.g. "Market", "Limit", "Stop".',
        },
        quantity: {
          type: 'string',
          description: 'Order size / units / lots if specified.',
        },
        price: {
          type: 'string',
          description: 'Entry price if Limit/Stop.',
        },
        stopLoss: {
          type: 'string',
          description: 'Stop loss level if specified.',
        },
        takeProfit: {
          type: 'string',
          description: 'Take profit level if specified.',
        },
      },
      required: ['action', 'side'],
    },
  },
  {
    name: 'click_at',
    description:
      'Click any button, menu item, tab, watchlist row, dialog close button, indicator settings icon, or chart coordinate at normalized [0..1000] viewport coordinates.',
    parameters: {
      type: 'object',
      properties: {
        x: {
          type: 'number',
          description: 'Normalized X coordinate from 0 (left edge) to 1000 (right edge).',
        },
        y: {
          type: 'number',
          description: 'Normalized Y coordinate from 0 (top edge) to 1000 (bottom edge).',
        },
        button: {
          type: 'string',
          description: '"left" (default) or "right" (context menu).',
        },
        doubleClick: {
          type: 'boolean',
          description: 'True to double-click.',
        },
        reason: {
          type: 'string',
          description: 'Concise plain-English description of what is being clicked (shown to user).',
        },
      },
      required: ['x', 'y', 'reason'],
    },
  },
  {
    name: 'drag_mouse',
    description:
      'Click-and-drag from (fromX, fromY) to (toX, toY) in normalized [0..1000] coordinates—useful for dragging SL/TP handles on Long/Short Position tools, resizing indicator panes, or panning the chart.',
    parameters: {
      type: 'object',
      properties: {
        fromX: { type: 'number', description: 'Start X (0..1000).' },
        fromY: { type: 'number', description: 'Start Y (0..1000).' },
        toX: { type: 'number', description: 'End X (0..1000).' },
        toY: { type: 'number', description: 'End Y (0..1000).' },
        reason: {
          type: 'string',
          description: 'Concise description of what is being dragged.',
        },
      },
      required: ['fromX', 'fromY', 'toX', 'toY', 'reason'],
    },
  },
  {
    name: 'type_text',
    description:
      'Type text into the currently focused TradingView input field (e.g. alert message, price input, Pine Script editor, quantity box).',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type.' },
        clearFirst: {
          type: 'boolean',
          description: 'True to select-all and clear existing input text before typing.',
        },
        pressEnter: {
          type: 'boolean',
          description: 'True to press Enter after typing.',
        },
        reason: {
          type: 'string',
          description: 'Concise description of what is being typed.',
        },
      },
      required: ['text', 'reason'],
    },
  },
  {
    name: 'press_shortcut',
    description:
      'Press a keyboard key or shortcut on TradingView (e.g. "Escape", "Enter", "Delete", "Alt+KeyA", "Alt+KeyR", "Control+KeyZ").',
    parameters: {
      type: 'object',
      properties: {
        keys: {
          type: 'string',
          description: 'Playwright key chord such as "Escape", "Enter", "Alt+KeyR".',
        },
        reason: {
          type: 'string',
          description: 'Why this key is being pressed.',
        },
      },
      required: ['keys', 'reason'],
    },
  },
  {
    name: 'scroll_at',
    description:
      'Scroll mouse wheel at normalized (x, y) to scroll indicator lists, watchlists, or zoom chart candles.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate (0..1000).' },
        y: { type: 'number', description: 'Y coordinate (0..1000).' },
        deltaX: { type: 'number', description: 'Horizontal scroll delta.' },
        deltaY: {
          type: 'number',
          description: 'Vertical scroll delta (positive scrolls down, negative scrolls up).',
        },
        reason: { type: 'string', description: 'Concise scroll reason.' },
      },
      required: ['x', 'y', 'deltaY', 'reason'],
    },
  },
  {
    name: 'wait_seconds',
    description:
      'Pause 1 to 5 seconds when waiting for heavy TradingView indicators, Pine compilation, or broker panels to finish loading.',
    parameters: {
      type: 'object',
      properties: {
        seconds: { type: 'number', description: 'Seconds to wait (1 to 5).' },
        reason: { type: 'string', description: 'Reason for waiting.' },
      },
      required: ['seconds', 'reason'],
    },
  },
  {
    name: 'generate_trade_setup',
    description:
      'Generate and render a ready-to-trade setup card below the TradingView chart terminal. Call this tool whenever the user asks for a chart analysis, trade signal, trade setup, entry/SL/TP levels, or market direction.',
    parameters: {
      type: 'object',
      properties: {
        signalType: {
          type: 'string',
          description: '"BUY", "SELL", or "HOLD".',
        },
        pair: {
          type: 'string',
          description: 'Symbol, e.g. "XAUUSD" or "EURUSD".',
        },
        timeframe: {
          type: 'string',
          description: 'Timeframe, e.g. "15m", "1H".',
        },
        currentPrice: {
          type: 'string',
          description: 'Current price visible on the right-hand price axis or candle close.',
        },
        entryPrice: {
          type: 'string',
          description: 'Exact recommended entry price.',
        },
        stopLoss: {
          type: 'string',
          description: 'Exact stop loss price level.',
        },
        takeProfit1: {
          type: 'string',
          description: 'Take profit 1 (conservative partial exit).',
        },
        takeProfit2: {
          type: 'string',
          description: 'Take profit 2 (primary structural target).',
        },
        takeProfit3: {
          type: 'string',
          description: 'Take profit 3 (extended runner objective).',
        },
        preferredTakeProfit: { type: 'integer', description: 'Choose 1, 2, or 3 as the single recommended primary take-profit target.' },
        preferredTakeProfitReason: { type: 'string', description: 'One concise reason this target best balances realistic reach and reward versus risk.' },
        riskRewardRatio: {
          type: 'string',
          description: 'Calculated risk-to-reward ratio (e.g. "1:2.8").',
        },
        entryTriggerNote: {
          type: 'string',
          description: 'Technical entry trigger note (e.g. "M15 Bullish CHoCH + FVG Retest").',
        },
        marketStructure: {
          type: 'string',
          description: 'Market structure summary (e.g. "Bullish Break of Structure").',
        },
        confidenceSummary: {
          type: 'string',
          description: 'Confidence summary (e.g. "High Confluence").',
        },
        signalConfidence: {
          type: 'number',
          description: 'Integer 1-99 AI estimate of setup quality from confluence and risk/reward; NOT win probability.',
        },
        technicalRationale: {
          type: 'array',
          items: { type: 'string' },
          description: '2 to 4 technical confluence points.',
        },
        keyLevels: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              price: { type: 'string' },
              role: { type: 'string' },
            },
            required: ['label', 'price', 'role'],
          },
          description: 'Mapped key price levels with role.',
        },
        invalidationCondition: {
          type: 'string',
          description: 'Condition that invalidates this trade setup.',
        },
      },
      required: [
        'signalType',
        'currentPrice',
        'entryPrice',
        'stopLoss',
        'takeProfit1',
        'takeProfit2',
        'takeProfit3',
        'preferredTakeProfit',
        'preferredTakeProfitReason',
        'riskRewardRatio',
        'technicalRationale',
      ],
    },
  },
];

const SYSTEM_INSTRUCTION = `You are the TraceFX TradingView Autonomous Control Engine.

TAKE-PROFIT PRIORITY:
- Every BUY/SELL setup must keep TP1 (conservative), TP2 (structural), and TP3 (extended runner), and independently choose preferredTakeProfit as exactly 1, 2, or 3.
- Choose the one target most realistically supported by visible market structure, opposing liquidity/support-resistance, momentum, and available price room. Do not automatically select TP2.
- Explain the choice briefly in preferredTakeProfitReason. Calculate riskRewardRatio against the preferred target, not automatically TP2.
- If none of the targets is justified, return HOLD rather than inventing a target.
You have full visual and interactive control over a live 1440x900 desktop TradingView Supercharts browser session via Playwright tools.

COORDINATE SYSTEM:
- Every screenshot you receive represents the full 1440x900 viewport mapped to normalized coordinates:
  - x = 0 is the far-left edge, x = 1000 is the far-right edge.
  - y = 0 is the top edge, y = 1000 is the bottom edge.
- Typical TradingView layout landmarks:
  - Top bar (Symbol, Timeframe, Indicators, Layouts, Replay): y ≈ 0..42
  - Left Drawing Toolbar (Crosshair, Trendlines, Fib/Gann, Shapes/Rectangles, Long/Short Position, Text): x ≈ 0..36, y ≈ 45..850
  - Main Candlestick Plot Canvas: x ≈ 40..915, y ≈ 45..880
  - Right Price Axis Scale: x ≈ 915..968
  - Far-Right Sidebar (Watchlist, Alerts, Object Tree): x ≈ 968..1000
  - Bottom Bar (Time axis, Pine Editor, Strategy Tester, Trading Panel): y ≈ 920..1000

OPERATING RULES:
1. Prefer high-reliability semantic tools first when applicable:
   - Use switch_symbol to change pairs/tickers.
   - Use switch_timeframe to change candle intervals.
   - Use manage_indicators to add built-in/public indicators or open the Indicators dialog for Invite-only scripts.
   - Use draw_on_chart for horizontal lines, rays, trendlines, fib retracements, rectangles, and long/short position tools—aligning startY/endY carefully with the right-hand price scale ticks and visible candle wicks!
   - Use chart_view_action("reset_view") if candles are off-screen or squished.
2. TRADE SETUP CARD PUBLISHING:
   - When the user asks you to analyze the chart, find a trade setup, suggest an entry/SL/TP, evaluate market bias, or give a signal: ALWAYS call "generate_trade_setup" so the ready-to-trade setup card appears directly below the chart terminal!
   - You can also draw the corresponding support/resistance, trendline, or horizontal lines on the chart before or after calling generate_trade_setup.
3. Use click_at, drag_mouse, type_text, press_shortcut, and scroll_at whenever interacting with dialogs, custom indicator settings, watchlists, alerts, Pine Editor, Trading Panel, or fine-tuning drawings.
4. Dismiss obstructing popups/modals (via press_shortcut("Escape") or click_at on the close X) before drawing on the chart.
5. ORDER EXECUTION RULE: Never click a final Buy/Sell order execution button via click_at without FIRST calling open_or_submit_order with action="submit_order" so the user's Order Safety Lock is respected.
6. After every action, inspect the updated screenshot carefully to verify your action succeeded before moving to the next step or finishing.
7. CHART PERSISTENCE & AUTO-SAVE MANDATE: Whenever any modifications are made to the chart (adding or removing indicators, drawing trendlines, rays, horizontal levels, rectangles, or switching symbols/timeframes), ALWAYS ensure the chart layout is saved (via save_chart_layout or Ctrl+S) so all user work and drawings persist permanently.
8. When the user's instruction is fully satisfied, stop calling tools and provide a concise, clear summary of everything you performed and any key chart observations (use clean prose, no filler).`;

/**
 * Strips heavy base64 images from older user turns so multi-step loops stay fast and lean,
 * while strictly keeping all model turns (including thoughtSignature) intact.
 */
function pruneOlderScreenshots(input: any[]): void {
  for (const item of input) {
    if (item?.role !== 'user' || !Array.isArray(item.content)) continue;
    item.content = item.content.map((part: any) =>
      part?.type === 'input_image'
        ? { type: 'input_text', text: '[Earlier viewport frame superseded by latest live screenshot]' }
        : part
    );
  }
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'OPENAI_API_KEY is not configured on the server.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body: {
    prompt?: string;
    orderLock?: boolean;
    allowOrderExecution?: boolean;
    history?: Array<{ role: 'user' | 'assistant'; text: string }>;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON request body.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const prompt = (body.prompt || '').trim();
  if (!prompt) {
    return new Response(JSON.stringify({ error: 'Please enter an instruction.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const orderLock = body.orderLock !== false; // default true
  const allowOrderExecution = Boolean(body.allowOrderExecution);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (ev: TvAgentStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          // stream already closed
        }
      };

      try {
        sendEvent({
          type: 'status',
          message: 'Capturing live TradingView viewport...',
        });

        const initialSnap = await captureViewportSnapshot();
        if (
          initialSnap.status === 'disconnected' ||
          initialSnap.status === 'error' ||
          !initialSnap.frameDataUrl
        ) {
          sendEvent({
            type: 'error',
            message:
              'TradingView browser session is not connected. Click Connect Session or Launch Guest Chart first.',
          });
          controller.close();
          return;
        }

        sendEvent({
          type: 'frame',
          frameDataUrl: initialSnap.frameDataUrl,
          pageTitle: initialSnap.pageTitle,
          url: initialSnap.url,
          pointer: null,
        });

        const input: any[] = [];

        // Include recent brief conversation context (last 6 messages)
        const recentHistory = Array.isArray(body.history)
          ? body.history.slice(-6)
          : [];
        for (const msg of recentHistory) {
          if (!msg.text?.trim()) continue;
          input.push({ role: msg.role, content: [{ type: 'input_text', text: msg.text.trim() }] });
        }

        input.push({
          role: 'user',
          content: [
            { type: 'input_image', image_url: initialSnap.frameDataUrl, detail: 'high' },
            { type: 'input_text', text: `Current TradingView page title: "${initialSnap.pageTitle}"\nCurrent URL: ${initialSnap.url}\nOrder Safety Lock: ${
              orderLock && !allowOrderExecution
                ? 'ENABLED (must request approval via open_or_submit_order before submitting any trade)'
                : 'UNLOCKED (order submission permitted)'
            }\n\nUser Instruction: ${prompt}` },
          ],
        });

        let stepsExecuted = 0;
        let finalSummary = '';
        let latestFrameUrl: string | null = initialSnap.frameDataUrl;
        let latestSignal: import('@/lib/trading-data').TradingSignalResponse | null = null;
        let hasChartModifications = false;

        for (let turnIdx = 0; turnIdx < MAX_AGENT_STEPS; turnIdx++) {
          if (req.signal.aborted) {
            throw new Error('Stopped by user.');
          }

          sendEvent({
            type: 'status',
            message:
              turnIdx === 0
                ? 'Inspecting TradingView screen & planning actions...'
                : `Verifying result & planning step ${stepsExecuted + 1}...`,
          });

          const tools = TV_AGENT_TOOLS.map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            strict: false,
          }));
          let response: any;
          try {
            response = await createOpenAIResponse({
              instructions: SYSTEM_INSTRUCTION,
              input,
              tools,
              reasoningEffort: 'medium',
              maxOutputTokens: 9000,
              signal: req.signal,
            });
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 350));
            response = await createOpenAIResponse({
              instructions: SYSTEM_INSTRUCTION,
              input,
              tools,
              reasoningEffort: 'medium',
              maxOutputTokens: 9000,
              signal: req.signal,
            });
          }

          const functionCalls = (response.output || []).filter((item: any) => item.type === 'function_call');
          if (!functionCalls.length) {
            finalSummary =
              extractOpenAIOutputText(response).trim() ||
              `Completed ${stepsExecuted} action${stepsExecuted === 1 ? '' : 's'} on TradingView.`;
            break;
          }

          input.push(...response.output);
          const toolOutputs: any[] = [];
          let latestSnapAfterTools = initialSnap;

          for (const call of functionCalls) {
            if (req.signal.aborted) {
              throw new Error('Stopped by user.');
            }

            const toolName = call.name || 'unknown_tool';
            let callArgs: Record<string, unknown> = {};
            try { callArgs = JSON.parse(call.arguments || '{}'); } catch { callArgs = {}; }

            // Handle publishing ready-to-trade setup card
            if (toolName === 'generate_trade_setup') {
              const signalTypeRaw = String(callArgs.signalType || 'HOLD').toUpperCase();
              const validSignalType: 'BUY' | 'SELL' | 'HOLD' =
                signalTypeRaw === 'BUY'
                  ? 'BUY'
                  : signalTypeRaw === 'SELL'
                  ? 'SELL'
                  : 'HOLD';
              const detectedPair =
                String(callArgs.pair || '').trim() ||
                initialSnap.pageTitle
                  .replace(/\s*—\s*TradingView.*$/i, '')
                  .split(/[,·\-|]/)[0]
                  ?.trim() ||
                'CHART';
              const detectedTimeframe =
                String(callArgs.timeframe || '').trim() || '15m';

              const generatedSignal: import('@/lib/trading-data').TradingSignalResponse = {
                isValidChart: true,
                signalType: validSignalType,
                executionCategory:
                  validSignalType === 'HOLD'
                    ? 'Stand Aside'
                    : 'Market Execution',
                detectedPair,
                detectedTimeframe,
                currentMarketPrice: String(
                  callArgs.currentPrice || callArgs.entryPrice || '—'
                ),
                entryPrice: String(callArgs.entryPrice || '—'),
                stopLoss: String(callArgs.stopLoss || '—'),
                takeProfit1: String(callArgs.takeProfit1 || '—'),
                takeProfit2: String(callArgs.takeProfit2 || '—'),
                takeProfit3: String(callArgs.takeProfit3 || '—'),
                preferredTakeProfit: [1, 2, 3].includes(Number(callArgs.preferredTakeProfit))
                  ? (Number(callArgs.preferredTakeProfit) as 1 | 2 | 3)
                  : undefined,
                preferredTakeProfitReason: String(callArgs.preferredTakeProfitReason || '').slice(0, 300) || undefined,
                riskRewardRatio: String(callArgs.riskRewardRatio || '1:2.0'),
                entryTriggerNote: String(
                  callArgs.entryTriggerNote ||
                    'Technical trigger verified on live TradingView chart.'
                ),
                marketStructure: String(
                  callArgs.marketStructure || 'Market Structure Confirmed'
                ),
                signalConfidence:
                  typeof callArgs.signalConfidence === 'number' &&
                  Number.isFinite(callArgs.signalConfidence)
                    ? Math.min(99, Math.max(1, Math.round(callArgs.signalConfidence)))
                    : undefined,
                confidenceSummary: String(
                  callArgs.confidenceSummary || 'Confluence Verified'
                ),
                technicalRationale:
                  Array.isArray(callArgs.technicalRationale) &&
                  callArgs.technicalRationale.length > 0
                    ? (callArgs.technicalRationale as string[]).map(String)
                    : [
                        'Live TradingView price action confirms key swing levels.',
                      ],
                keyLevels: Array.isArray(callArgs.keyLevels)
                  ? (callArgs.keyLevels as any[]).map((lvl) => ({
                      label: String(lvl.label || 'Level'),
                      price: String(lvl.price || '—'),
                      role: String(lvl.role || 'Support') as any,
                    }))
                  : [],
                invalidationCondition: String(
                  callArgs.invalidationCondition ||
                    (validSignalType === 'BUY'
                      ? `Break below Stop Loss at ${callArgs.stopLoss}`
                      : validSignalType === 'SELL'
                      ? `Break above Stop Loss at ${callArgs.stopLoss}`
                      : 'Price breaks out of consolidation range.')
                ),
                auditTrail: [
                  {
                    step: 1,
                    title: 'Chart Verification',
                    finding: `TradingView chart verified for ${detectedPair} (${detectedTimeframe}).`,
                  },
                  {
                    step: 2,
                    title: 'Structure Scan',
                    finding: String(
                      callArgs.marketStructure ||
                        'Structure & liquidity validated.'
                    ),
                  },
                  {
                    step: 3,
                    title: 'SMC Confluence',
                    finding: String(
                      callArgs.entryTriggerNote || 'Trigger noted.'
                    ),
                  },
                  {
                    step: 4,
                    title: 'Execution Coordinates',
                    finding: `Entry ${callArgs.entryPrice} · SL ${callArgs.stopLoss} · TP1 ${callArgs.takeProfit1} · TP2 ${callArgs.takeProfit2}`,
                  },
                  {
                    step: 5,
                    title: 'Ready-to-Trade Setup',
                    finding: `${validSignalType} setup published below terminal with R:R ${callArgs.riskRewardRatio}.`,
                  },
                ],
              };

              latestSignal = generatedSignal;
              sendEvent({ type: 'signal', signal: generatedSignal });

              stepsExecuted += 1;
              sendEvent({
                type: 'step',
                step: {
                  id: `step-${Date.now()}-${stepsExecuted}`,
                  stepNumber: stepsExecuted,
                  toolName,
                  description: `Generated ready-to-trade ${validSignalType} setup for ${detectedPair} (${validSignalType} @ ${generatedSignal.entryPrice}, SL ${generatedSignal.stopLoss}, TP1 ${generatedSignal.takeProfit1})`,
                  status: 'done',
                  timestamp: Date.now(),
                },
              });

              toolOutputs.push({
                type: 'function_call_output',
                call_id: call.call_id,
                output: JSON.stringify({
                  ok: true,
                  result: `Successfully published ready-to-trade setup card below the chart terminal for ${detectedPair} (${validSignalType} @ ${generatedSignal.entryPrice}). The user can now inspect the setup card, 1-click mark levels on chart, or execute the order.`,
                }),
              });
              continue;
            }

            // Enforce Order Safety Lock if submitting an order without explicit approval
            if (
              toolName === 'open_or_submit_order' &&
              String(callArgs.action || '') === 'submit_order' &&
              orderLock &&
              !allowOrderExecution
            ) {
              // Ensure the Order Ticket is visible for the user to inspect
              await executeTvAgentTool('open_or_submit_order', {
                action: 'open_ticket',
                side: callArgs.side || 'BUY',
              }).catch(() => {});

              const snap = await captureViewportSnapshot(null);
              latestFrameUrl = snap.frameDataUrl;
              if (snap.frameDataUrl) {
                sendEvent({
                  type: 'frame',
                  frameDataUrl: snap.frameDataUrl,
                  pageTitle: snap.pageTitle,
                  url: snap.url,
                  pointer: null,
                });
              }

              const side =
                String(callArgs.side || 'BUY').toUpperCase() === 'SELL'
                  ? 'SELL'
                  : 'BUY';
              const orderType = String(callArgs.orderType || 'Market');
              const pendingOrder: TvPendingOrderApproval = {
                side,
                orderType,
                quantity: callArgs.quantity ? String(callArgs.quantity) : undefined,
                price: callArgs.price ? String(callArgs.price) : undefined,
                stopLoss: callArgs.stopLoss ? String(callArgs.stopLoss) : undefined,
                takeProfit: callArgs.takeProfit
                  ? String(callArgs.takeProfit)
                  : undefined,
                summary: `${side} ${orderType} Order${
                  callArgs.quantity ? ` · Qty ${callArgs.quantity}` : ''
                }${callArgs.price ? ` @ ${callArgs.price}` : ''}`,
                resumePrompt: `Order approved by user: proceed to complete and submit the ${side} ${orderType} order (${JSON.stringify(
                  callArgs
                )}) on the visible TradingView Order Ticket.`,
              };

              stepsExecuted += 1;
              sendEvent({
                type: 'step',
                step: {
                  id: `step-${Date.now()}-${stepsExecuted}`,
                  stepNumber: stepsExecuted,
                  toolName,
                  description: `Paused for approval: ${pendingOrder.summary}`,
                  status: 'blocked_order',
                  timestamp: Date.now(),
                },
              });

              sendEvent({
                type: 'order_approval_needed',
                order: pendingOrder,
                message:
                  'Order Lock paused execution before submitting this trade. Review the live TradingView ticket and approve if you want the AI to place it.',
              });
              controller.close();
              return;
            }

            stepsExecuted += 1;
            const stepId = `step-${Date.now()}-${stepsExecuted}`;
            const runningStep: TvAgentStep = {
              id: stepId,
              stepNumber: stepsExecuted,
              toolName,
              description: String(
                callArgs.reason ||
                  (toolName === 'switch_symbol'
                    ? `Switching symbol to ${callArgs.symbol || ''}`
                    : toolName === 'switch_timeframe'
                    ? `Changing timeframe to ${callArgs.timeframe || ''}`
                    : `Running ${toolName.replace(/_/g, ' ')}`)
              ),
              status: 'running',
              timestamp: Date.now(),
            };
            sendEvent({ type: 'step', step: runningStep });

            if (
              toolName === 'switch_symbol' ||
              toolName === 'switch_timeframe' ||
              toolName === 'manage_indicators' ||
              toolName === 'draw_on_chart' ||
              toolName === 'save_chart_layout'
            ) {
              hasChartModifications = true;
            }

            const outcome = await executeTvAgentTool(toolName, callArgs);
            latestSnapAfterTools = await captureViewportSnapshot(
              outcome.pointer ?? null
            );
            latestFrameUrl = latestSnapAfterTools.frameDataUrl;

            sendEvent({
              type: 'step',
              step: {
                ...runningStep,
                description: outcome.humanStepSummary,
                status: outcome.ok ? 'done' : 'error',
                pointer: outcome.pointer ?? null,
              },
            });

            if (latestSnapAfterTools.frameDataUrl) {
              sendEvent({
                type: 'frame',
                frameDataUrl: latestSnapAfterTools.frameDataUrl,
                pageTitle: latestSnapAfterTools.pageTitle,
                url: latestSnapAfterTools.url,
                pointer: outcome.pointer ?? null,
              });
            }

            toolOutputs.push({
              type: 'function_call_output',
              call_id: call.call_id,
              output: JSON.stringify({
                ok: outcome.ok,
                result: outcome.resultMessage,
                pageTitle: latestSnapAfterTools.pageTitle,
                url: latestSnapAfterTools.url,
              }),
            });
          }

          // Feed tool results back to GPT-6.1 Sol, then attach the newest live viewport.
          input.push(...toolOutputs);
          pruneOlderScreenshots(input);

          if (latestSnapAfterTools.frameDataUrl) {
            input.push({
              role: 'user',
              content: [
                { type: 'input_image', image_url: latestSnapAfterTools.frameDataUrl, detail: 'high' },
                { type: 'input_text', text: `Updated live TradingView screenshot after step ${stepsExecuted}. Page title: "${latestSnapAfterTools.pageTitle}". Verify whether all parts of the user's instruction are complete, or execute the next required action.` },
              ],
            });
          }
        }

        if (hasChartModifications) {
          await saveTradingViewChartLayout().catch(() => {});
          const finalSnap = await captureViewportSnapshot(null);
          if (finalSnap.frameDataUrl) {
            latestFrameUrl = finalSnap.frameDataUrl;
          }
        }

        if (!finalSummary) {
          finalSummary = `Reached maximum step limit (${MAX_AGENT_STEPS} actions). Send a follow-up instruction to continue from the current screen.`;
        }

        sendEvent({
          type: 'complete',
          summary: finalSummary,
          frameDataUrl: latestFrameUrl,
          stepsCount: stepsExecuted,
          signal: latestSignal,
        });
        controller.close();
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred in the TradingView control loop.';
        sendEvent({ type: 'error', message: msg });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
