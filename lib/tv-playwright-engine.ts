import fs from 'node:fs';
import path from 'node:path';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Cookie,
  type Page,
} from 'playwright-core';
import type {
  TvConnectPayload,
  TvManualInputPayload,
  TvPointerMarker,
  TvSessionInfo,
  TvSessionStatus,
} from '@/lib/tv-engine-types';

const VIEWPORT_WIDTH = 1440;
const VIEWPORT_HEIGHT = 900;
const DEFAULT_TV_CHART_URL = 'https://www.tradingview.com/chart/';
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

interface EngineSingletonState {
  browser: Browser | null;
  context: BrowserContext | null;
  page: Page | null;
  status: TvSessionStatus;
  accountLabel: string | null;
  authNotice: string | null;
  errorMessage: string | null;
  lastFrameDataUrl: string | null;
  lastActionPointer: TvPointerMarker | null;
  updatedAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  opLock: Promise<void>;
}

declare global {
  var __tracefxTvEngineState: EngineSingletonState | undefined;
}

function getEngineState(): EngineSingletonState {
  if (!globalThis.__tracefxTvEngineState) {
    globalThis.__tracefxTvEngineState = {
      browser: null,
      context: null,
      page: null,
      status: 'disconnected',
      accountLabel: null,
      authNotice: null,
      errorMessage: null,
      lastFrameDataUrl: null,
      lastActionPointer: null,
      updatedAt: Date.now(),
      idleTimer: null,
      opLock: Promise.resolve(),
    };
  }
  return globalThis.__tracefxTvEngineState;
}

function touchIdleTimer(state: EngineSingletonState) {
  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
  }
  state.idleTimer = setTimeout(() => {
    void disconnectTvSession();
  }, IDLE_TIMEOUT_MS);
}

function clampNorm(val: unknown, fallback = 500): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1000, num));
}

export function normToPxX(normX: number): number {
  return Math.round((clampNorm(normX) / 1000) * VIEWPORT_WIDTH);
}

export function normToPxY(normY: number): number {
  return Math.round((clampNorm(normY) / 1000) * VIEWPORT_HEIGHT);
}

/**
 * Locates a working Chromium binary inside the container or host system.
 */
function resolveChromiumExecutablePath(): string | undefined {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }

  const directCandidates = [
    '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
  ];

  for (const candidate of directCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Scan /ms-playwright subdirectories dynamically in case browser revision varies
  const msRoot = '/ms-playwright';
  if (fs.existsSync(msRoot)) {
    try {
      const entries = fs.readdirSync(msRoot);
      for (const entry of entries) {
        const subShell = path.join(
          msRoot,
          entry,
          'chrome-headless-shell-linux64',
          'chrome-headless-shell'
        );
        if (fs.existsSync(subShell)) return subShell;

        const subChrome = path.join(msRoot, entry, 'chrome-linux', 'chrome');
        if (fs.existsSync(subChrome)) return subChrome;
      }
    } catch {
      // ignore fs scan errors
    }
  }

  try {
    const defaultPath = chromium.executablePath();
    if (defaultPath && fs.existsSync(defaultPath)) {
      return defaultPath;
    }
  } catch {
    // ignore
  }

  return undefined;
}

function cleanCookieValue(raw: string, cookieName: string): string {
  let trimmed = raw.trim();
  const prefix = `${cookieName}=`;
  if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
    trimmed = trimmed.slice(prefix.length).trim();
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  if (trimmed.endsWith(';')) {
    trimmed = trimmed.slice(0, -1).trim();
  }
  return trimmed;
}

function normalizeSameSite(raw: unknown): 'Strict' | 'Lax' | 'None' {
  const s = String(raw || '').toLowerCase().trim();
  if (s === 'strict') return 'Strict';
  if (s === 'none' || s === 'no_restriction') return 'None';
  return 'Lax';
}

export function parseTradingViewCookies(payload: TvConnectPayload): Cookie[] {
  if (payload.mode === 'guest') {
    return [];
  }

  if (payload.mode === 'cookies') {
    const sessionId = cleanCookieValue(payload.sessionId || '', 'sessionid');
    const sessionIdSign = cleanCookieValue(
      payload.sessionIdSign || '',
      'sessionid_sign'
    );
    const deviceT = cleanCookieValue(payload.deviceT || '', 'device_t');

    if (!sessionId) {
      throw new Error(
        'Please enter your TradingView sessionid cookie value (or switch to Guest Chart).'
      );
    }

    const cookies: Cookie[] = [
      {
        name: 'sessionid',
        value: sessionId,
        domain: '.tradingview.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        expires: -1,
      },
    ];

    if (sessionIdSign) {
      cookies.push({
        name: 'sessionid_sign',
        value: sessionIdSign,
        domain: '.tradingview.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        expires: -1,
      });
    }

    if (deviceT) {
      cookies.push({
        name: 'device_t',
        value: deviceT,
        domain: '.tradingview.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'None',
        expires: -1,
      });
    }

    return cookies;
  }

  // JSON or raw Cookie header mode
  const rawText = (payload.cookieJson || '').trim();
  if (!rawText) {
    throw new Error('Please paste your TradingView cookies JSON or header string.');
  }

  // Support raw header string format: "sessionid=abc; sessionid_sign=xyz"
  if (!rawText.startsWith('[') && !rawText.startsWith('{') && rawText.includes('=')) {
    const pairs = rawText.split(';').map((part) => part.trim()).filter(Boolean);
    const parsedFromHeader: Cookie[] = [];
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx <= 0) continue;
      const name = pair.slice(0, eqIdx).trim();
      const value = pair.slice(eqIdx + 1).trim();
      if (!name || !value) continue;
      parsedFromHeader.push({
        name,
        value,
        domain: '.tradingview.com',
        path: '/',
        httpOnly: name.startsWith('sessionid'),
        secure: true,
        sameSite: 'Lax',
        expires: -1,
      });
    }
    if (parsedFromHeader.length === 0) {
      throw new Error('Could not parse cookies from the provided string.');
    }
    return parsedFromHeader;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new Error(
      'Invalid JSON format. Paste a Cookie-Editor JSON array or use Quick Cookie Fields.'
    );
  }

  const rawList: unknown[] = Array.isArray(parsedJson)
    ? parsedJson
    : parsedJson &&
        typeof parsedJson === 'object' &&
        Array.isArray((parsedJson as { cookies?: unknown[] }).cookies)
      ? (parsedJson as { cookies: unknown[] }).cookies
      : [];

  if (rawList.length === 0) {
    throw new Error('No cookies found inside the pasted JSON.');
  }

  const normalized: Cookie[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const name = String(rec.name || '').trim();
    const value = String(rec.value ?? '').trim();
    if (!name) continue;

    const rawDomain = String(rec.domain || '.tradingview.com').trim();
    // Keep only tradingview cookies so unrelated site exports never break context.addCookies
    if (!rawDomain.includes('tradingview.com')) continue;

    const sameSite = normalizeSameSite(rec.sameSite);
    const rawExpires = Number(rec.expires ?? rec.expirationDate ?? -1);
    const expires =
      Number.isFinite(rawExpires) && rawExpires > 0
        ? Math.floor(rawExpires)
        : -1;

    normalized.push({
      name,
      value,
      domain: rawDomain,
      path: String(rec.path || '/'),
      httpOnly: Boolean(rec.httpOnly),
      secure: sameSite === 'None' ? true : rec.secure !== false,
      sameSite,
      expires,
    });
  }

  if (normalized.length === 0) {
    throw new Error('No tradingview.com cookies were found in the pasted JSON.');
  }

  return normalized;
}

function sanitizeChartUrl(rawUrl?: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return DEFAULT_TV_CHART_URL;
  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      parsed.hostname.endsWith('tradingview.com')
    ) {
      return parsed.toString();
    }
  } catch {
    // fallback
  }
  return DEFAULT_TV_CHART_URL;
}

async function dismissInitialBannersIfPresent(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      // Dismiss standard GDPR cookie bar if visible so it doesn't obscure bottom Trading Panel
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const btn of buttons) {
        const txt = (btn.textContent || '').trim().toLowerCase();
        if (txt === 'accept all' || txt === 'accept cookies') {
          (btn as HTMLButtonElement).click();
          break;
        }
      }
    });
  } catch {
    // ignore
  }
}

async function detectTradingViewIdentity(page: Page): Promise<{
  isLoggedIn: boolean;
  username: string | null;
}> {
  try {
    return await page.evaluate(() => {
      const win = window as unknown as {
        user?: { username?: string; id?: number };
        initData?: { user?: { username?: string; id?: number } };
      };
      const uname =
        win.user?.username || win.initData?.user?.username || null;
      if (uname && uname.toLowerCase() !== 'guest') {
        return { isLoggedIn: true, username: uname };
      }
      const userMenuBtn = document.querySelector(
        '.tv-header__user-menu-button--logged-in, [data-name="header-user-menu-button"]'
      );
      if (userMenuBtn) {
        const aria = userMenuBtn.getAttribute('aria-label') || '';
        // Guest button often says "Open user menu" without avatar/badge, check inner img/initials
        const hasAvatar = Boolean(
          userMenuBtn.querySelector('img, [class*="userPic"], [class*="avatar"]')
        );
        if (hasAvatar || (aria && !aria.toLowerCase().includes('anonymous'))) {
          return { isLoggedIn: true, username: null };
        }
      }
      return { isLoggedIn: false, username: null };
    });
  } catch {
    return { isLoggedIn: false, username: null };
  }
}

export async function captureViewportSnapshot(
  pointer?: TvPointerMarker | null
): Promise<TvSessionInfo> {
  const state = getEngineState();
  touchIdleTimer(state);

  if (pointer !== undefined) {
    state.lastActionPointer = pointer;
  }

  const page = state.page;
  if (!page || page.isClosed() || !state.browser?.isConnected()) {
    state.status = 'disconnected';
    return {
      status: 'disconnected',
      url: DEFAULT_TV_CHART_URL,
      pageTitle: 'Not Connected',
      accountLabel: null,
      viewportWidth: VIEWPORT_WIDTH,
      viewportHeight: VIEWPORT_HEIGHT,
      frameDataUrl: null,
      lastActionPointer: null,
      authNotice: null,
      errorMessage: state.errorMessage,
      updatedAt: Date.now(),
    };
  }

  try {
    const buffer = await page.screenshot({
      type: 'jpeg',
      quality: 82,
      animations: 'disabled',
    });
    const frameDataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;
    const pageTitle = (await page.title().catch(() => 'TradingView Chart')) || 'TradingView Chart';
    const currentUrl = page.url() || DEFAULT_TV_CHART_URL;

    state.lastFrameDataUrl = frameDataUrl;
    state.updatedAt = Date.now();

    return {
      status: state.status,
      url: currentUrl,
      pageTitle,
      accountLabel: state.accountLabel,
      viewportWidth: VIEWPORT_WIDTH,
      viewportHeight: VIEWPORT_HEIGHT,
      frameDataUrl,
      lastActionPointer: state.lastActionPointer,
      authNotice: state.authNotice,
      errorMessage: null,
      updatedAt: state.updatedAt,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to capture browser viewport.';
    return {
      status: state.status,
      url: page.url() || DEFAULT_TV_CHART_URL,
      pageTitle: 'TradingView Chart',
      accountLabel: state.accountLabel,
      viewportWidth: VIEWPORT_WIDTH,
      viewportHeight: VIEWPORT_HEIGHT,
      frameDataUrl: state.lastFrameDataUrl,
      lastActionPointer: state.lastActionPointer,
      authNotice: state.authNotice,
      errorMessage: msg,
      updatedAt: Date.now(),
    };
  }
}

export async function getTvSessionInfo(refreshFrame = false): Promise<TvSessionInfo> {
  const state = getEngineState();
  if (!state.page || state.page.isClosed() || !state.browser?.isConnected()) {
    return {
      status: 'disconnected',
      url: DEFAULT_TV_CHART_URL,
      pageTitle: 'Not Connected',
      accountLabel: null,
      viewportWidth: VIEWPORT_WIDTH,
      viewportHeight: VIEWPORT_HEIGHT,
      frameDataUrl: null,
      lastActionPointer: null,
      authNotice: null,
      errorMessage: state.errorMessage,
      updatedAt: state.updatedAt,
    };
  }

  if (refreshFrame || !state.lastFrameDataUrl) {
    return captureViewportSnapshot();
  }

  const pageTitle =
    (await state.page.title().catch(() => 'TradingView Chart')) ||
    'TradingView Chart';

  return {
    status: state.status,
    url: state.page.url() || DEFAULT_TV_CHART_URL,
    pageTitle,
    accountLabel: state.accountLabel,
    viewportWidth: VIEWPORT_WIDTH,
    viewportHeight: VIEWPORT_HEIGHT,
    frameDataUrl: state.lastFrameDataUrl,
    lastActionPointer: state.lastActionPointer,
    authNotice: state.authNotice,
    errorMessage: state.errorMessage,
    updatedAt: state.updatedAt,
  };
}

export async function disconnectTvSession(): Promise<void> {
  const state = getEngineState();
  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }
  try {
    if (state.context) {
      await state.context.close().catch(() => {});
    }
    if (state.browser) {
      await state.browser.close().catch(() => {});
    }
  } finally {
    state.page = null;
    state.context = null;
    state.browser = null;
    state.status = 'disconnected';
    state.accountLabel = null;
    state.authNotice = null;
    state.errorMessage = null;
    state.lastFrameDataUrl = null;
    state.lastActionPointer = null;
    state.updatedAt = Date.now();
  }
}

export async function connectTvSession(
  payload: TvConnectPayload
): Promise<TvSessionInfo> {
  const state = getEngineState();
  const cookies = parseTradingViewCookies(payload);
  const targetUrl = sanitizeChartUrl(payload.chartUrl);

  await disconnectTvSession();
  state.status = 'launching';
  state.errorMessage = null;
  state.authNotice = null;

  try {
    const executablePath = resolveChromiumExecutablePath();
    const browser = await chromium.launch({
      headless: true,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        `--window-size=${VIEWPORT_WIDTH},${VIEWPORT_HEIGHT}`,
        '--enable-webgl',
        '--use-gl=swiftshader',
        '--ignore-gpu-blocklist',
      ],
    });

    const context = await browser.newContext({
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      deviceScaleFactor: 1,
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'en-US',
      colorScheme: 'dark',
    });

    if (cookies.length > 0) {
      await context.addCookies(cookies);
    }

    const page = await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 35000,
    });

    // Wait for TradingView chart canvas to mount and paint candles
    await page
      .waitForSelector('canvas', { state: 'visible', timeout: 15000 })
      .catch(() => {});
    await page.waitForTimeout(2400);
    await dismissInitialBannersIfPresent(page);
    await page.waitForTimeout(400);

    const identity = await detectTradingViewIdentity(page);

    state.browser = browser;
    state.context = context;
    state.page = page;

    if (payload.mode === 'guest') {
      state.status = 'connected_guest';
      state.accountLabel = 'Guest Workspace';
      state.authNotice = null;
    } else if (identity.isLoggedIn) {
      state.status = 'connected_auth';
      state.accountLabel = identity.username
        ? `@${identity.username}`
        : 'Authenticated Session';
      state.authNotice = null;
    } else {
      // Cookies were provided, check if sessionid is still present in context cookies
      const activeCookies = await context.cookies('https://www.tradingview.com');
      const hasSessionCookie = activeCookies.some((c) => c.name === 'sessionid' && c.value);
      if (hasSessionCookie) {
        state.status = 'connected_auth';
        state.accountLabel = 'Session Cookie Active';
        state.authNotice =
          'Cookies loaded. If your private layouts do not appear, include both sessionid and sessionid_sign from an active TradingView tab.';
      } else {
        state.status = 'connected_guest';
        state.accountLabel = 'Guest Fallback';
        state.authNotice =
          'TradingView rejected or expired the session cookie and opened in Guest mode. Re-copy fresh sessionid + sessionid_sign values.';
      }
    }

    touchIdleTimer(state);
    return await captureViewportSnapshot(null);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Failed to launch cloud Chromium session.';
    await disconnectTvSession();
    state.status = 'error';
    state.errorMessage = message;
    return {
      status: 'error',
      url: targetUrl,
      pageTitle: 'Connection Failed',
      accountLabel: null,
      viewportWidth: VIEWPORT_WIDTH,
      viewportHeight: VIEWPORT_HEIGHT,
      frameDataUrl: null,
      lastActionPointer: null,
      authNotice: null,
      errorMessage: message,
      updatedAt: Date.now(),
    };
  }
}

export function getActiveTvPage(): Page {
  const state = getEngineState();
  if (!state.page || state.page.isClosed() || !state.browser?.isConnected()) {
    throw new Error(
      'No active TradingView browser session. Connect your session or launch a Guest Chart first.'
    );
  }
  touchIdleTimer(state);
  return state.page;
}

export async function performManualTvInput(
  input: TvManualInputPayload
): Promise<TvSessionInfo> {
  const page = getActiveTvPage();
  let pointer: TvPointerMarker | null = null;

  switch (input.type) {
    case 'click': {
      const px = normToPxX(input.x);
      const py = normToPxY(input.y);
      if (input.doubleClick) {
        await page.mouse.dblclick(px, py, { button: input.button || 'left' });
      } else {
        await page.mouse.click(px, py, { button: input.button || 'left' });
      }
      await page.waitForTimeout(350);
      pointer = {
        x: clampNorm(input.x),
        y: clampNorm(input.y),
        kind: 'click',
        label: 'Manual click',
        timestamp: Date.now(),
      };
      break;
    }
    case 'drag': {
      const x1 = normToPxX(input.fromX);
      const y1 = normToPxY(input.fromY);
      const x2 = normToPxX(input.toX);
      const y2 = normToPxY(input.toY);
      await page.mouse.move(x1, y1);
      await page.mouse.down();
      await page.mouse.move(x2, y2, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(350);
      pointer = {
        x: clampNorm(input.fromX),
        y: clampNorm(input.fromY),
        endX: clampNorm(input.toX),
        endY: clampNorm(input.toY),
        kind: 'drag',
        label: 'Manual drag',
        timestamp: Date.now(),
      };
      break;
    }
    case 'wheel': {
      const px = normToPxX(input.x);
      const py = normToPxY(input.y);
      await page.mouse.move(px, py);
      await page.mouse.wheel(
        Math.max(-800, Math.min(800, Number(input.deltaX) || 0)),
        Math.max(-800, Math.min(800, Number(input.deltaY) || 0))
      );
      await page.waitForTimeout(300);
      break;
    }
    case 'type': {
      if (input.text) {
        await page.keyboard.type(input.text, { delay: 18 });
      }
      if (input.pressEnter) {
        await page.keyboard.press('Enter');
      }
      await page.waitForTimeout(450);
      break;
    }
    case 'key': {
      if (input.key) {
        await page.keyboard.press(input.key);
        await page.waitForTimeout(350);
      }
      break;
    }
    case 'navigate': {
      const cleanUrl = sanitizeChartUrl(input.url);
      await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      break;
    }
    case 'refresh': {
      break;
    }
  }

  return captureViewportSnapshot(pointer ?? undefined);
}

function normalizeTradingViewIntervalInput(raw: string): string {
  const upper = raw.trim().toUpperCase();
  const map: Record<string, string> = {
    '1M_MIN': '1',
    M1: '1',
    '1M': '1',
    '1MIN': '1',
    M3: '3',
    '3M': '3',
    M5: '5',
    '5M': '5',
    '5MIN': '5',
    M15: '15',
    '15M': '15',
    '15MIN': '15',
    M30: '30',
    '30M': '30',
    M45: '45',
    '45M': '45',
    H1: '60',
    '1H': '60',
    '60M': '60',
    H2: '120',
    '2H': '120',
    H4: '240',
    '4H': '240',
    D: '1D',
    D1: '1D',
    '1D': '1D',
    DAILY: '1D',
    W: '1W',
    W1: '1W',
    '1W': '1W',
    WEEKLY: '1W',
    MN: '1M',
    MONTHLY: '1M',
  };
  return map[upper] || raw.trim();
}

export interface ToolExecutionOutcome {
  ok: boolean;
  resultMessage: string;
  humanStepSummary: string;
  pointer?: TvPointerMarker | null;
}

/**
 * Executes a single Gemini tool call against the live TradingView Playwright page.
 */
export async function executeTvAgentTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolExecutionOutcome> {
  const page = getActiveTvPage();

  switch (toolName) {
    case 'switch_symbol': {
      const symbol = String(args.symbol || '').trim().toUpperCase();
      if (!symbol) {
        return {
          ok: false,
          resultMessage: 'Missing symbol argument.',
          humanStepSummary: 'Skipped empty symbol switch',
        };
      }

      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(150);

      const searchBtn = page.locator('#header-toolbar-symbol-search').first();
      if (await searchBtn.isVisible().catch(() => false)) {
        await searchBtn.click({ timeout: 3000 });
      } else {
        // Focus chart center and start typing to invoke TradingView symbol search modal
        await page.mouse.click(normToPxX(480), normToPxY(450));
      }
      await page.waitForTimeout(350);

      // Select any existing text in search input and type target symbol
      await page.keyboard.press('Control+A').catch(() => {});
      await page.keyboard.press('Backspace').catch(() => {});
      await page.keyboard.type(symbol, { delay: 28 });
      await page.waitForTimeout(850);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2000);

      return {
        ok: true,
        resultMessage: `Switched TradingView chart symbol to ${symbol}. Inspect the top-left symbol header on the new screenshot to confirm.`,
        humanStepSummary: `Switched symbol to ${symbol}`,
      };
    }

    case 'switch_timeframe': {
      const rawTf = String(args.timeframe || '').trim();
      const tvInterval = normalizeTradingViewIntervalInput(rawTf);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(120);
      // Focus chart pane so TradingView comma shortcut opens Change Interval dialog
      await page.mouse.click(normToPxX(480), normToPxY(450));
      await page.waitForTimeout(120);
      await page.keyboard.press(',');
      await page.waitForTimeout(280);
      await page.keyboard.type(tvInterval, { delay: 35 });
      await page.waitForTimeout(200);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1600);

      return {
        ok: true,
        resultMessage: `Changed chart timeframe to ${rawTf} (interval code ${tvInterval}).`,
        humanStepSummary: `Changed timeframe to ${rawTf}`,
      };
    }

    case 'manage_indicators': {
      const action = String(args.action || 'add').trim();
      const query = String(args.indicatorQuery || '').trim();

      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(150);

      if (action === 'add' || action === 'open_menu') {
        const indBtn = page.locator('#header-toolbar-indicators').first();
        if (await indBtn.isVisible().catch(() => false)) {
          await indBtn.click({ timeout: 3000 });
        } else {
          await page.mouse.click(normToPxX(480), normToPxY(450));
          await page.keyboard.press('/');
        }
        await page.waitForTimeout(650);

        if (query) {
          await page.keyboard.type(query, { delay: 25 });
          await page.waitForTimeout(1000);
        }

        if (action === 'add' && query) {
          // Click first matching indicator row inside the dialog
          const firstRow = page
            .locator(
              '[data-name="indicators-dialog"] [data-role="list-item"], [class*="dialog"] [data-role="list-item"]'
            )
            .first();
          if (await firstRow.isVisible().catch(() => false)) {
            await firstRow.click({ timeout: 3000 });
            await page.waitForTimeout(600);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(900);
            return {
              ok: true,
              resultMessage: `Added indicator matching "${query}" and closed the Indicators dialog.`,
              humanStepSummary: `Added indicator: ${query}`,
            };
          }
          return {
            ok: true,
            resultMessage: `Opened Indicators dialog and searched "${query}". Inspect the visible list on screen and use click_at to select the exact indicator row, then press Escape.`,
            humanStepSummary: `Searched indicators for "${query}"`,
          };
        }

        return {
          ok: true,
          resultMessage:
            'Opened TradingView Indicators dialog. You can now inspect tabs (Technicals, Invite-only, Favorites) and click items with click_at.',
          humanStepSummary: 'Opened Indicators menu',
        };
      }

      return {
        ok: false,
        resultMessage: `Unsupported indicator action "${action}".`,
        humanStepSummary: `Skipped unknown indicator action`,
      };
    }

    case 'draw_on_chart': {
      const tool = String(args.tool || 'trendline').trim();
      const x1 = clampNorm(args.startX, 350);
      const y1 = clampNorm(args.startY, 450);
      const x2 = clampNorm(args.endX, 680);
      const y2 = clampNorm(args.endY, 450);
      const px1 = normToPxX(x1);
      const py1 = normToPxY(y1);
      const px2 = normToPxX(x2);
      const py2 = normToPxY(y2);

      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(150);
      // Focus chart area first
      await page.mouse.move(normToPxX(480), normToPxY(450));

      const singlePointShortcuts: Record<string, string> = {
        horizontal_line: 'Alt+KeyH',
        horizontal_ray: 'Alt+KeyJ',
        vertical_line: 'Alt+KeyV',
        cross_line: 'Alt+KeyC',
      };

      if (singlePointShortcuts[tool]) {
        await page.mouse.move(px1, py1);
        await page.waitForTimeout(120);
        // Move cursor to target coordinate and trigger TradingView instant line shortcut, or select tool & click
        if (tool === 'horizontal_line' || tool === 'vertical_line' || tool === 'horizontal_ray') {
          await page.mouse.click(px1, py1);
          await page.waitForTimeout(100);
          await page.keyboard.press(singlePointShortcuts[tool]);
          await page.waitForTimeout(450);
        } else {
          await page.keyboard.press(singlePointShortcuts[tool]);
          await page.waitForTimeout(200);
          await page.mouse.click(px1, py1);
          await page.waitForTimeout(400);
        }
        return {
          ok: true,
          resultMessage: `Placed ${tool.replace(/_/g, ' ')} at (${x1}, ${y1}).`,
          humanStepSummary: `Drew ${tool.replace(/_/g, ' ')}`,
          pointer: {
            x: x1,
            y: y1,
            kind: 'draw',
            label: tool.replace(/_/g, ' '),
            timestamp: Date.now(),
          },
        };
      }

      if (tool === 'trendline' || tool === 'fib_retracement') {
        const shortcut = tool === 'trendline' ? 'Alt+KeyT' : 'Alt+KeyF';
        await page.keyboard.press(shortcut);
        await page.waitForTimeout(250);
        await page.mouse.move(px1, py1);
        await page.mouse.click(px1, py1);
        await page.waitForTimeout(220);
        await page.mouse.move(px2, py2, { steps: 14 });
        await page.waitForTimeout(150);
        await page.mouse.click(px2, py2);
        await page.waitForTimeout(450);

        return {
          ok: true,
          resultMessage: `Drew ${tool.replace(/_/g, ' ')} from (${x1}, ${y1}) to (${x2}, ${y2}).`,
          humanStepSummary: `Drew ${tool.replace(/_/g, ' ')}`,
          pointer: {
            x: x1,
            y: y1,
            endX: x2,
            endY: y2,
            kind: 'draw',
            label: tool.replace(/_/g, ' '),
            timestamp: Date.now(),
          },
        };
      }

      // Toolbar-based two-point tools: rectangle, long_position, short_position
      const toolSelectors: Record<string, { group: string; item: string }> = {
        rectangle: {
          group: '[data-name="linetool-group-geometric-shapes"]',
          item: '[data-name="LineToolRectangle"]',
        },
        long_position: {
          group: '[data-name="linetool-group-prediction-and-measurement"]',
          item: '[data-name="LineToolRiskRewardLong"]',
        },
        short_position: {
          group: '[data-name="linetool-group-prediction-and-measurement"]',
          item: '[data-name="LineToolRiskRewardShort"]',
        },
      };

      const targetSel = toolSelectors[tool];
      if (targetSel) {
        let selected = false;
        const directItem = page.locator(targetSel.item).first();
        if (await directItem.isVisible().catch(() => false)) {
          await directItem.click({ timeout: 2500 });
          selected = true;
        } else {
          // Click the group dropdown arrow or right-click/open submenu on the left drawing toolbar
          const groupBtn = page.locator(targetSel.group).first();
          if (await groupBtn.isVisible().catch(() => false)) {
            const box = await groupBtn.boundingBox();
            if (box) {
              // Hover group button to reveal small submenu caret or click right edge
              await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2);
              await page.waitForTimeout(180);
              const caret = page
                .locator(`${targetSel.group} [class*="arrow"], ${targetSel.group} + div`)
                .first();
              if (await caret.isVisible().catch(() => false)) {
                await caret.click({ timeout: 2000 }).catch(() => {});
              } else {
                await groupBtn.click({ button: 'right' }).catch(() => {});
              }
              await page.waitForTimeout(300);
              const menuItem = page.locator(targetSel.item).first();
              if (await menuItem.isVisible().catch(() => false)) {
                await menuItem.click({ timeout: 2500 });
                selected = true;
              } else {
                await groupBtn.click({ timeout: 2500 });
                selected = true;
              }
            }
          }
        }

        if (selected) {
          await page.waitForTimeout(250);
          await page.mouse.move(px1, py1);
          await page.mouse.click(px1, py1);
          await page.waitForTimeout(250);
          if (tool === 'rectangle') {
            await page.mouse.move(px2, py2, { steps: 14 });
            await page.waitForTimeout(150);
            await page.mouse.click(px2, py2);
          }
          await page.waitForTimeout(500);
          return {
            ok: true,
            resultMessage: `Placed ${tool.replace(/_/g, ' ')} on chart at (${x1}, ${y1}) -> (${x2}, ${y2}).`,
            humanStepSummary: `Placed ${tool.replace(/_/g, ' ')} on chart`,
            pointer: {
              x: x1,
              y: y1,
              endX: x2,
              endY: y2,
              kind: 'draw',
              label: tool.replace(/_/g, ' '),
              timestamp: Date.now(),
            },
          };
        }
      }

      return {
        ok: false,
        resultMessage: `Could not auto-locate drawing tool "${tool}" via DOM shortcut; inspect the left drawing toolbar (~x=18) on the screenshot and select it with click_at.`,
        humanStepSummary: `Checked toolbar for ${tool}`,
      };
    }

    case 'chart_view_action': {
      const action = String(args.action || 'reset_view').trim();
      await page.mouse.move(normToPxX(480), normToPxY(450));

      if (action === 'reset_view') {
        await page.keyboard.press('Alt+KeyR');
      } else if (action === 'zoom_in') {
        await page.mouse.wheel(0, -360);
      } else if (action === 'zoom_out') {
        await page.mouse.wheel(0, 360);
      } else if (action === 'pan_left') {
        await page.mouse.move(normToPxX(320), normToPxY(450));
        await page.mouse.down();
        await page.mouse.move(normToPxX(680), normToPxY(450), { steps: 12 });
        await page.mouse.up();
      } else if (action === 'pan_right') {
        await page.mouse.move(normToPxX(680), normToPxY(450));
        await page.mouse.down();
        await page.mouse.move(normToPxX(350), normToPxY(450), { steps: 12 });
        await page.mouse.up();
      } else if (action === 'undo') {
        await page.keyboard.press('Control+KeyZ');
      } else if (action === 'open_alerts') {
        await page.keyboard.press('Alt+KeyA');
      } else if (action === 'toggle_log_scale') {
        await page.keyboard.press('Alt+KeyL');
      }
      await page.waitForTimeout(650);

      return {
        ok: true,
        resultMessage: `Executed chart view action: ${action}.`,
        humanStepSummary: `Chart action: ${action.replace(/_/g, ' ')}`,
      };
    }

    case 'switch_layout': {
      const target = String(args.layoutUrlOrName || '').trim();
      if (target.startsWith('http://') || target.startsWith('https://')) {
        const clean = sanitizeChartUrl(target);
        await page.goto(clean, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2200);
        return {
          ok: true,
          resultMessage: `Navigated to TradingView layout URL ${clean}.`,
          humanStepSummary: 'Loaded custom layout URL',
        };
      }

      // Open Save/Load layout menu in top header
      const layoutMenu = page.locator('#header-toolbar-save-load').first();
      if (await layoutMenu.isVisible().catch(() => false)) {
        const box = await layoutMenu.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width - 6, box.y + box.height / 2);
          await page.waitForTimeout(650);
          return {
            ok: true,
            resultMessage: `Opened layout menu to find "${target}". Inspect dropdown on screenshot and click "Load layout" or your target layout with click_at.`,
            humanStepSummary: 'Opened chart layouts menu',
          };
        }
      }

      return {
        ok: false,
        resultMessage:
          'Layout dropdown button not directly matched; inspect top-right toolbar on the screenshot and click your layout selector with click_at.',
        humanStepSummary: 'Checked top toolbar for layouts',
      };
    }

    case 'open_or_submit_order': {
      const action = String(args.action || 'open_ticket').trim();
      const side = String(args.side || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';

      if (action === 'open_ticket') {
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(120);
        await page.mouse.click(normToPxX(480), normToPxY(450));
        await page.keyboard.press('Shift+KeyT');
        await page.waitForTimeout(850);
        return {
          ok: true,
          resultMessage: `Opened TradingView Order Ticket (${side}). Inspect the order panel on the screenshot to set exact price/SL/TP fields or click Paper Trading if not yet connected.`,
          humanStepSummary: `Opened ${side} Order Ticket`,
        };
      }

      // submit_order (only reached when Order Lock is off or user explicitly approved)
      await page.keyboard.press('Shift+KeyT').catch(() => {});
      await page.waitForTimeout(600);
      return {
        ok: true,
        resultMessage: `Order execution unlocked for ${side}. Use click_at on the visible Order Ticket fields and final ${side} submit button on screen to complete placement.`,
        humanStepSummary: `Unlocked ${side} order placement`,
      };
    }

    case 'click_at': {
      const x = clampNorm(args.x, 500);
      const y = clampNorm(args.y, 500);
      const button = String(args.button || 'left') === 'right' ? 'right' : 'left';
      const doubleClick = Boolean(args.doubleClick);
      const reason = String(args.reason || `Clicked (${x}, ${y})`).trim();
      const px = normToPxX(x);
      const py = normToPxY(y);

      if (doubleClick) {
        await page.mouse.dblclick(px, py, { button });
      } else {
        await page.mouse.click(px, py, { button });
      }
      await page.waitForTimeout(600);

      return {
        ok: true,
        resultMessage: `Clicked (${x}, ${y}) [${px}px, ${py}px] (${button}${doubleClick ? ', double-click' : ''}).`,
        humanStepSummary: reason,
        pointer: {
          x,
          y,
          kind: 'click',
          label: reason,
          timestamp: Date.now(),
        },
      };
    }

    case 'drag_mouse': {
      const fromX = clampNorm(args.fromX, 500);
      const fromY = clampNorm(args.fromY, 500);
      const toX = clampNorm(args.toX, 500);
      const toY = clampNorm(args.toY, 500);
      const reason = String(
        args.reason || `Dragged (${fromX}, ${fromY}) to (${toX}, ${toY})`
      ).trim();

      await page.mouse.move(normToPxX(fromX), normToPxY(fromY));
      await page.mouse.down();
      await page.mouse.move(normToPxX(toX), normToPxY(toY), { steps: 14 });
      await page.mouse.up();
      await page.waitForTimeout(550);

      return {
        ok: true,
        resultMessage: `Dragged from (${fromX}, ${fromY}) to (${toX}, ${toY}).`,
        humanStepSummary: reason,
        pointer: {
          x: fromX,
          y: fromY,
          endX: toX,
          endY: toY,
          kind: 'drag',
          label: reason,
          timestamp: Date.now(),
        },
      };
    }

    case 'type_text': {
      const text = String(args.text ?? '');
      const pressEnter = Boolean(args.pressEnter);
      const clearFirst = Boolean(args.clearFirst);
      const reason = String(args.reason || `Typed "${text.slice(0, 28)}"`).trim();

      if (clearFirst) {
        await page.keyboard.press('Control+KeyA').catch(() => {});
        await page.keyboard.press('Backspace').catch(() => {});
      }
      if (text) {
        await page.keyboard.type(text, { delay: 22 });
      }
      if (pressEnter) {
        await page.keyboard.press('Enter');
      }
      await page.waitForTimeout(600);

      return {
        ok: true,
        resultMessage: `Typed text${pressEnter ? ' and pressed Enter' : ''}.`,
        humanStepSummary: reason,
      };
    }

    case 'press_shortcut': {
      const keys = String(args.keys || 'Escape').trim();
      const reason = String(args.reason || `Pressed ${keys}`).trim();
      await page.keyboard.press(keys);
      await page.waitForTimeout(500);

      return {
        ok: true,
        resultMessage: `Pressed keyboard shortcut "${keys}".`,
        humanStepSummary: reason,
      };
    }

    case 'scroll_at': {
      const x = clampNorm(args.x, 500);
      const y = clampNorm(args.y, 450);
      const deltaX = Math.max(-1000, Math.min(1000, Number(args.deltaX) || 0));
      const deltaY = Math.max(-1000, Math.min(1000, Number(args.deltaY) || 0));
      const reason = String(args.reason || 'Scrolled viewport').trim();

      await page.mouse.move(normToPxX(x), normToPxY(y));
      await page.mouse.wheel(deltaX, deltaY);
      await page.waitForTimeout(500);

      return {
        ok: true,
        resultMessage: `Scrolled (${deltaX}, ${deltaY}) at (${x}, ${y}).`,
        humanStepSummary: reason,
      };
    }

    case 'wait_seconds': {
      const secs = Math.max(0.5, Math.min(5, Number(args.seconds) || 1.5));
      const reason = String(args.reason || `Waited ${secs}s for chart render`).trim();
      await page.waitForTimeout(Math.round(secs * 1000));
      return {
        ok: true,
        resultMessage: `Waited ${secs} seconds.`,
        humanStepSummary: reason,
      };
    }

    default:
      return {
        ok: false,
        resultMessage: `Unknown tool "${toolName}".`,
        humanStepSummary: `Skipped unknown action ${toolName}`,
      };
  }
}
