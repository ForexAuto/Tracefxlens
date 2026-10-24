import { SignalType, TradingSignalResponse } from './trading-data';

const DB_NAME = 'tracefx_lens_persistence';
const DB_VERSION = 2;
const STORE_NAME = 'workspace_state';
export const HISTORY_STORE_NAME = 'signal_history';
const RECORD_KEY = 'active_analyze_session';
const PREFS_LOCAL_KEY = 'tracefx_lens_prefs_v1';

export interface PersistedWorkspaceState {
  selectedPair: string;
  selectedTimeframe: string;
  imageDataUrl: string | null;
  signal: TradingSignalResponse | null;
  rejectedFinding?: string | null;
  wasAnalyzing?: boolean;
  updatedAt: number;
}

interface LightweightPrefs {
  selectedPair: string;
  selectedTimeframe: string;
}

export function openAppDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(HISTORY_STORE_NAME)) {
        db.createObjectStore(HISTORY_STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return openAppDatabase();
}

export function saveLightweightPrefs(prefs: LightweightPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFS_LOCAL_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota / private mode restrictions
  }
}

export function loadLightweightPrefs(): LightweightPrefs | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PREFS_LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LightweightPrefs>;
    if (parsed.selectedPair && parsed.selectedTimeframe) {
      return {
        selectedPair: String(parsed.selectedPair),
        selectedTimeframe: String(parsed.selectedTimeframe),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveWorkspaceState(
  state: Omit<PersistedWorkspaceState, 'updatedAt'>
): Promise<void> {
  saveLightweightPrefs({
    selectedPair: state.selectedPair,
    selectedTimeframe: state.selectedTimeframe,
  });

  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const payload: PersistedWorkspaceState = {
        ...state,
        updatedAt: Date.now(),
      };
      store.put(payload, RECORD_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error('IndexedDB write failed'));
      };
    });
  } catch {
    // Fallback for restricted WebViews where IndexedDB is blocked
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(
          RECORD_KEY,
          JSON.stringify({ ...state, updatedAt: Date.now() })
        );
      } catch {
        // Ignore if image exceeds localStorage quota
      }
    }
  }
}

function sanitizePersistedSignal(
  rawSignal: TradingSignalResponse | null | undefined
): TradingSignalResponse | null {
  if (!rawSignal) return null;
  const upper = String(rawSignal.signalType || 'HOLD').toUpperCase();
  let signalType: SignalType = 'HOLD';
  if (upper.startsWith('BUY')) signalType = 'BUY';
  else if (upper.startsWith('SELL')) signalType = 'SELL';

  return {
    ...rawSignal,
    signalType,
    executionCategory:
      signalType === 'HOLD' ? 'Stand Aside' : 'Market Execution',
  };
}

export async function loadWorkspaceState(): Promise<PersistedWorkspaceState | null> {
  const fallbackPrefs = loadLightweightPrefs();

  try {
    const db = await openDatabase();
    const record = await new Promise<PersistedWorkspaceState | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(RECORD_KEY);
      req.onsuccess = () => {
        db.close();
        resolve((req.result as PersistedWorkspaceState) || null);
      };
      req.onerror = () => {
        db.close();
        reject(req.error || new Error('IndexedDB read failed'));
      };
    });

    if (record) {
      return {
        selectedPair: record.selectedPair || fallbackPrefs?.selectedPair || 'XAU/USD',
        selectedTimeframe: record.selectedTimeframe || fallbackPrefs?.selectedTimeframe || 'H1',
        imageDataUrl: record.imageDataUrl ?? null,
        signal: sanitizePersistedSignal(record.signal),
        rejectedFinding: record.rejectedFinding ?? null,
        wasAnalyzing: Boolean(record.wasAnalyzing),
        updatedAt: record.updatedAt || Date.now(),
      };
    }
  } catch {
    // Fallback read from localStorage if IndexedDB is unavailable
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(RECORD_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as PersistedWorkspaceState;
          return {
            ...parsed,
            signal: sanitizePersistedSignal(parsed.signal),
          };
        }
      } catch {
        // Ignore parse error
      }
    }
  }

  if (fallbackPrefs) {
    return {
      selectedPair: fallbackPrefs.selectedPair,
      selectedTimeframe: fallbackPrefs.selectedTimeframe,
      imageDataUrl: null,
      signal: null,
      wasAnalyzing: false,
      updatedAt: Date.now(),
    };
  }

  return null;
}
