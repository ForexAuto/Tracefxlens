import type { TradingSignalResponse } from '@/lib/trading-data';
import type { TvConnectPayload, TvPendingOrderApproval, TvAgentStep } from '@/lib/tv-engine-types';

export interface CommandTurnPersisted {
  id: string;
  prompt: string;
  steps: TvAgentStep[];
  summary: string | null;
  error: string | null;
  pendingOrder: TvPendingOrderApproval | null;
  statusMessage: string | null;
  isRunning: boolean;
  createdAt: number;
}

export interface PersistedTvWorkspaceState {
  activeSignal: TradingSignalResponse | null;
  turns: CommandTurnPersisted[];
  orderLock: boolean;
  promptInput: string;
  manualMode: boolean;
  updatedAt: number;
}

const TV_CREDENTIALS_STORAGE_KEY = 'tracefx_tv_credentials_v1';
const TV_WORKSPACE_STORAGE_KEY = 'tracefx_tv_workspace_state_v1';

export function saveTvCredentials(payload: TvConnectPayload): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      TV_CREDENTIALS_STORAGE_KEY,
      JSON.stringify(payload)
    );
  } catch {
    // Ignore storage quota or security restrictions
  }
}

export function getTvCredentials(): TvConnectPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(TV_CREDENTIALS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TvConnectPayload>;
    return {
      mode:
        parsed.mode === 'json' || parsed.mode === 'guest'
          ? parsed.mode
          : 'cookies',
      sessionId: parsed.sessionId || '',
      sessionIdSign: parsed.sessionIdSign || '',
      deviceT: parsed.deviceT || '',
      cookieJson: parsed.cookieJson || '',
      chartUrl: parsed.chartUrl || '',
    };
  } catch {
    return null;
  }
}

export function clearTvCredentials(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(TV_CREDENTIALS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function saveTvWorkspaceState(state: Omit<PersistedTvWorkspaceState, 'updatedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: PersistedTvWorkspaceState = {
      ...state,
      // Cap turns to last 12 items so localStorage doesn't bloat
      turns: (state.turns || []).slice(-12).map((t) => ({
        ...t,
        isRunning: false,
        statusMessage: null,
      })),
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(
      TV_WORKSPACE_STORAGE_KEY,
      JSON.stringify(payload)
    );
  } catch {
    // ignore
  }
}

export function loadTvWorkspaceState(): PersistedTvWorkspaceState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(TV_WORKSPACE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedTvWorkspaceState>;
    return {
      activeSignal: parsed.activeSignal || null,
      turns: Array.isArray(parsed.turns)
        ? parsed.turns.map((t) => ({ ...t, isRunning: false, statusMessage: null }))
        : [],
      orderLock: parsed.orderLock !== false,
      promptInput: parsed.promptInput || '',
      manualMode: Boolean(parsed.manualMode),
      updatedAt: parsed.updatedAt || Date.now(),
    };
  } catch {
    return null;
  }
}

export function clearTvWorkspaceState(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(TV_WORKSPACE_STORAGE_KEY);
  } catch {
    // ignore
  }
}
