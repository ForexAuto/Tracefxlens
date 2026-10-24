import type {
  SignalHistoryRecord,
  TradeOutcome,
  TradingSignalResponse,
} from './trading-data';
import { HISTORY_STORE_NAME, openAppDatabase } from './workspace-storage';

const FALLBACK_HISTORY_LOCAL_KEY = 'tracefx_lens_history_fallback_v1';
const DELETED_TOMBSTONE_KEY = 'tracefx_lens_deleted_history_v1';
export const HISTORY_UPDATED_EVENT = 'tracefx-history-updated';

interface DeletedHistoryTombstones {
  ids: string[];
  fingerprints: string[];
}

function readDeletedTombstones(): DeletedHistoryTombstones {
  if (typeof window === 'undefined') {
    return { ids: [], fingerprints: [] };
  }
  try {
    const raw = window.localStorage.getItem(DELETED_TOMBSTONE_KEY);
    if (!raw) return { ids: [], fingerprints: [] };
    const parsed = JSON.parse(raw) as Partial<DeletedHistoryTombstones>;
    return {
      ids: Array.isArray(parsed.ids) ? parsed.ids.map(String) : [],
      fingerprints: Array.isArray(parsed.fingerprints)
        ? parsed.fingerprints.map(String)
        : [],
    };
  } catch {
    return { ids: [], fingerprints: [] };
  }
}

function writeDeletedTombstones(data: DeletedHistoryTombstones): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      DELETED_TOMBSTONE_KEY,
      JSON.stringify({
        ids: Array.from(new Set(data.ids)).slice(-200),
        fingerprints: Array.from(new Set(data.fingerprints)).slice(-200),
      })
    );
  } catch {
    // Ignore storage write failure
  }
}

function emitHistoryUpdated(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(HISTORY_UPDATED_EVENT));
}

export function buildSignalFingerprint(signal: TradingSignalResponse): string {
  return [
    signal.detectedPair.trim().toUpperCase(),
    signal.detectedTimeframe.trim().toUpperCase(),
    signal.signalType,
    signal.entryPrice.trim(),
    signal.stopLoss.trim(),
    signal.takeProfit1.trim(),
    signal.takeProfit2.trim(),
  ].join('|');
}

/**
 * Compresses chart screenshot to a crisp ~960px JPEG (~55KB) so storing & syncing
 * history records to Supabase and IndexedDB is sub-second while keeping Y-axis ticks clear.
 */
async function compressChartForHistory(
  imageDataUrl: string | null
): Promise<string | null> {
  if (!imageDataUrl || typeof window === 'undefined') return imageDataUrl;
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onerror = () => resolve(imageDataUrl);
    img.onload = () => {
      const maxDim = 960;
      let { naturalWidth: w, naturalHeight: h } = img;
      if (w <= 0 || h <= 0) {
        resolve(imageDataUrl);
        return;
      }
      if (w > maxDim || h > maxDim) {
        const scale = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(imageDataUrl);
        return;
      }
      ctx.fillStyle = '#090D16';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.src = imageDataUrl;
  });
}

function mergeClientServerRecord(
  a: SignalHistoryRecord,
  b: SignalHistoryRecord
): SignalHistoryRecord {
  // Permanent lock invariant: once either copy is WON or LOST, it stays locked forever
  const lockedOutcome = a.outcome ?? b.outcome;
  const lockedAt = a.outcome
    ? a.outcomeLockedAt
    : b.outcome
    ? b.outcomeLockedAt || new Date().toISOString()
    : null;

  return {
    ...a,
    chartImageUrl: a.chartImageUrl || b.chartImageUrl,
    chartMarkup: a.chartMarkup || b.chartMarkup,
    outcome: lockedOutcome,
    outcomeLockedAt: lockedAt,
  };
}

export async function loadLocalHistory(): Promise<SignalHistoryRecord[]> {
  try {
    const db = await openAppDatabase();
    const items = await new Promise<SignalHistoryRecord[]>((resolve, reject) => {
      const tx = db.transaction(HISTORY_STORE_NAME, 'readonly');
      const store = tx.objectStore(HISTORY_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        db.close();
        resolve((req.result as SignalHistoryRecord[]) || []);
      };
      req.onerror = () => {
        db.close();
        reject(req.error || new Error('Failed to load local history'));
      };
    });

    return items.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  } catch {
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(FALLBACK_HISTORY_LOCAL_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as SignalHistoryRecord[];
          return parsed.sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
        }
      } catch {
        // Ignore storage read failure
      }
    }
    return [];
  }
}

async function saveAllLocalHistory(records: SignalHistoryRecord[]): Promise<void> {
  const sorted = [...records]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, 120);

  try {
    const db = await openAppDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(HISTORY_STORE_NAME, 'readwrite');
      const store = tx.objectStore(HISTORY_STORE_NAME);
      for (const rec of sorted) {
        store.put(rec);
      }
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error('Failed to write local history'));
      };
    });
  } catch {
    if (typeof window !== 'undefined') {
      try {
        // Strip heavy images if falling back to 5MB localStorage
        const slim = sorted.map((r) => ({ ...r, chartImageUrl: null }));
        window.localStorage.setItem(
          FALLBACK_HISTORY_LOCAL_KEY,
          JSON.stringify(slim)
        );
      } catch {
        // Ignore quota limits
      }
    }
  }
}

/**
 * Archives a newly generated (or hydrated) valid signal into local IndexedDB
 * and syncs it to the Supabase backend via POST /api/history.
 */
export async function recordSignalToHistory(
  signal: TradingSignalResponse,
  imageDataUrl: string | null,
  options?: { deduplicateByFingerprint?: boolean; createdAtIso?: string }
): Promise<SignalHistoryRecord | null> {
  if (!signal || !signal.isValidChart) return null;

  const fingerprint = buildSignalFingerprint(signal);
  const tombstones = readDeletedTombstones();
  const existing = await loadLocalHistory();

  if (options?.deduplicateByFingerprint) {
    // Do not resurrect a workspace signal that the user explicitly deleted from History
    if (tombstones.fingerprints.includes(fingerprint)) {
      return null;
    }
    const found = existing.find((item) => item.fingerprint === fingerprint);
    if (found) return found;
  } else {
    // Fresh user-initiated scan: clear any prior fingerprint tombstone so the new scan saves
    if (tombstones.fingerprints.includes(fingerprint)) {
      writeDeletedTombstones({
        ids: tombstones.ids,
        fingerprints: tombstones.fingerprints.filter((fp) => fp !== fingerprint),
      });
    }
    // Prevent accidental double-insert within 8 seconds for identical fingerprint
    const recentMatch = existing.find(
      (item) =>
        item.fingerprint === fingerprint &&
        Date.now() - new Date(item.createdAt).getTime() < 8_000
    );
    if (recentMatch) return recentMatch;
  }

  const compressedChart = await compressChartForHistory(imageDataUrl);
  const createdAt = options?.createdAtIso || new Date().toISOString();
  const id = `sig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const newRecord: SignalHistoryRecord = {
    id,
    fingerprint,
    pair: signal.detectedPair,
    timeframe: signal.detectedTimeframe,
    signalType: signal.signalType,
    executionCategory: signal.executionCategory,
    currentMarketPrice: signal.currentMarketPrice,
    entryPrice: signal.entryPrice,
    stopLoss: signal.stopLoss,
    takeProfit1: signal.takeProfit1,
    takeProfit2: signal.takeProfit2,
    takeProfit3: signal.takeProfit3,
    riskRewardRatio: signal.riskRewardRatio,
    marketStructure: signal.marketStructure,
    confidenceSummary: signal.confidenceSummary,
    entryTriggerNote: signal.entryTriggerNote,
    invalidationCondition: signal.invalidationCondition,
    technicalRationale: signal.technicalRationale,
    keyLevels: signal.keyLevels,
    chartMarkup: signal.chartMarkup,
    chartImageUrl: compressedChart,
    outcome: null,
    outcomeLockedAt: null,
    createdAt,
  };

  await saveAllLocalHistory([newRecord, ...existing]);
  emitHistoryUpdated();

  // Push to Supabase server endpoint
  try {
    await fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record: newRecord }),
    });
  } catch {
    // Will automatically sync on next syncHistoryWithServer()
  }

  return newRecord;
}

/**
 * Synchronizes local IndexedDB history with Supabase (/api/history) in both
 * directions while guaranteeing locked outcomes can never be altered.
 */
export async function syncHistoryWithServer(): Promise<SignalHistoryRecord[]> {
  const localRecords = await loadLocalHistory();

  try {
    const res = await fetch('/api/history', { method: 'GET', cache: 'no-store' });
    if (!res.ok) return localRecords;

    const json = (await res.json()) as { records?: SignalHistoryRecord[] };
    const rawRemoteRecords = Array.isArray(json.records) ? json.records : [];
    const tombstones = readDeletedTombstones();
    const deletedIdSet = new Set(tombstones.ids);

    // Ensure any pending offline single-item deletions are propagated to the server
    const remoteRecords: SignalHistoryRecord[] = [];
    for (const rem of rawRemoteRecords) {
      if (deletedIdSet.has(rem.id)) {
        void fetch(`/api/history/${encodeURIComponent(rem.id)}`, {
          method: 'DELETE',
        }).catch(() => {});
        continue;
      }
      remoteRecords.push(rem);
    }

    const byId = new Map<string, SignalHistoryRecord>();

    for (const rem of remoteRecords) {
      byId.set(rem.id, rem);
    }

    const unsyncedToPush: SignalHistoryRecord[] = [];

    for (const loc of localRecords) {
      const rem = byId.get(loc.id);
      if (rem) {
        const merged = mergeClientServerRecord(loc, rem);
        byId.set(loc.id, merged);
        if (loc.outcome && !rem.outcome) {
          unsyncedToPush.push(merged);
        }
      } else {
        // Also check fingerprint match so backfilled records don't duplicate
        const fpMatch = remoteRecords.find(
          (r) => r.fingerprint && r.fingerprint === loc.fingerprint
        );
        if (fpMatch) {
          byId.set(fpMatch.id, mergeClientServerRecord(fpMatch, loc));
        } else {
          byId.set(loc.id, loc);
          unsyncedToPush.push(loc);
        }
      }
    }

    const mergedList = Array.from(byId.values()).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    await saveAllLocalHistory(mergedList);

    if (unsyncedToPush.length > 0) {
      void fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: unsyncedToPush }),
      }).catch(() => {});
    }

    emitHistoryUpdated();
    return mergedList;
  } catch {
    return localRecords;
  }
}

/**
 * Permanently locks a trade history record as WON or LOST.
 * Once locked, neither client nor server will ever permit changing it again.
 */
export async function lockSignalOutcomePermanent(
  id: string,
  outcome: TradeOutcome
): Promise<SignalHistoryRecord[]> {
  const current = await loadLocalHistory();
  const target = current.find((item) => item.id === id);

  // Strict client-side immutability guard
  if (target && (target.outcome === 'WON' || target.outcome === 'LOST')) {
    return current;
  }

  const lockedAt = new Date().toISOString();
  const updatedList = current.map((item) =>
    item.id === id
      ? {
          ...item,
          outcome,
          outcomeLockedAt: lockedAt,
        }
      : item
  );

  await saveAllLocalHistory(updatedList);
  emitHistoryUpdated();

  try {
    const res = await fetch(`/api/history/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome }),
    });

    if (res.status === 409) {
      // Server already had a locked outcome — honor server's locked state
      const payload = (await res.json()) as { record?: SignalHistoryRecord };
      if (payload?.record?.outcome) {
        const reconciled = updatedList.map((item) =>
          item.id === id ? mergeClientServerRecord(payload.record!, item) : item
        );
        await saveAllLocalHistory(reconciled);
        emitHistoryUpdated();
        return reconciled;
      }
    }
  } catch {
    // Local lock is saved and will push to Supabase on next syncHistoryWithServer
  }

  return updatedList;
}

/**
 * Deletes a single history record by ID from IndexedDB, local fallback storage,
 * and Supabase via DELETE /api/history/[id]. Bulk deletion is never exposed.
 */
export async function deleteSingleHistoryRecord(
  id: string
): Promise<SignalHistoryRecord[]> {
  const cleanId = id.trim();
  const current = await loadLocalHistory();
  if (!cleanId) return current;

  const target = current.find((item) => item.id === cleanId);
  const remaining = current.filter((item) => item.id !== cleanId);

  // Record deletion tombstone so workspace hydration never re-creates this deleted item
  const tombstones = readDeletedTombstones();
  writeDeletedTombstones({
    ids: [...tombstones.ids, cleanId],
    fingerprints: target?.fingerprint
      ? [...tombstones.fingerprints, target.fingerprint]
      : tombstones.fingerprints,
  });

  // Remove the single key directly from IndexedDB
  try {
    const db = await openAppDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(HISTORY_STORE_NAME, 'readwrite');
      const store = tx.objectStore(HISTORY_STORE_NAME);
      store.delete(cleanId);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error('Failed to delete history record'));
      };
    });
  } catch {
    // Fallback handled below
  }

  if (typeof window !== 'undefined') {
    try {
      const slim = remaining.map((r) => ({ ...r, chartImageUrl: null }));
      window.localStorage.setItem(
        FALLBACK_HISTORY_LOCAL_KEY,
        JSON.stringify(slim)
      );
    } catch {
      // Ignore fallback write error
    }
  }

  emitHistoryUpdated();

  try {
    await fetch(`/api/history/${encodeURIComponent(cleanId)}`, {
      method: 'DELETE',
    });
  } catch {
    // Tombstone will retry single DELETE on next syncHistoryWithServer
  }

  return remaining;
}

