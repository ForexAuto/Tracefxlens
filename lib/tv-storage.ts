import type { TradingSignalResponse } from '@/lib/trading-data';
import type { TvConnectPayload } from '@/lib/tv-engine-types';


export interface PersistedTvWorkspaceState {
  activeSignal: TradingSignalResponse | null;
  orderLock: boolean;
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
      orderLock: true,
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
