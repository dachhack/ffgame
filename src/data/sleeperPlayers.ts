// Sleeper's full NFL player directory (~5MB), needed to turn a league's roster
// player_ids into names / positions / NFL teams. Fetched at most once a day and
// cached in IndexedDB so the season sim loads instantly on repeat visits.
import type { Pos } from '../types';

export interface PlayerMeta { id: string; full: string; pos: Pos; team: string | null; espnId?: string; }

const URL_ALL = 'https://api.sleeper.app/v1/players/nfl';
const DB = 'gridiron-clash';
const STORE = 'kv';
const KEY = 'sleeper-players-nfl';
const TTL = 24 * 60 * 60 * 1000; // refresh at most once a day

let mem: Map<string, PlayerMeta> | null = null;

function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
function idbGet<T>(db: IDBDatabase, key: string): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      r.onsuccess = () => resolve((r.result as T) ?? null);
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
function idbSet(db: IDBDatabase, key: string, val: unknown): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = () => resolve(); tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}

const FANTASY: Record<string, Pos> = {
  QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', K: 'K', DEF: 'DEF',
  // IDP — collapse Sleeper's sub-positions into the three groups.
  DL: 'DL', DE: 'DL', DT: 'DL', NT: 'DL', EDGE: 'DL',
  LB: 'LB', ILB: 'LB', OLB: 'LB', MLB: 'LB',
  DB: 'DB', CB: 'DB', S: 'DB', FS: 'DB', SS: 'DB',
};

function parse(raw: Record<string, Record<string, unknown>>): Map<string, PlayerMeta> {
  const out = new Map<string, PlayerMeta>();
  for (const [id, p] of Object.entries(raw)) {
    const pos = FANTASY[String(p.position ?? '')];
    if (!pos) continue;
    const full = pos === 'DEF'
      ? `${p.team ?? id} DST`
      : String(p.full_name ?? (`${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || id));
    const espnId = p.espn_id != null && p.espn_id !== '' ? String(p.espn_id) : undefined;
    out.set(id, { id, full, pos, team: (p.team as string) ?? (pos === 'DEF' ? id : null), espnId });
  }
  return out;
}

// Fetch with a hard timeout so a stalled connection fails fast (and can be
// retried) instead of hanging the sim build forever.
async function fetchJson(url: string, ms: number): Promise<Record<string, Record<string, unknown>>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`player directory: HTTP ${res.status}`);
    return (await res.json()) as Record<string, Record<string, unknown>>;
  } finally {
    clearTimeout(timer);
  }
}

/** Load (and cache) the Sleeper player directory. `onProgress` fires with a note. */
export async function loadPlayerDirectory(onProgress?: (note: string) => void): Promise<Map<string, PlayerMeta>> {
  if (mem) return mem;
  const db = await idb();
  if (db) {
    const hit = await idbGet<{ ts: number; data: Record<string, Record<string, unknown>> }>(db, KEY);
    if (hit && Date.now() - hit.ts < TTL && hit.data) {
      onProgress?.('Loading player directory (cached)…');
      mem = parse(hit.data);
      return mem;
    }
  }
  onProgress?.('Downloading Sleeper player directory (~5MB, one-time)…');
  // One retry: a 5MB fetch can stall on flaky networks; abort and try again
  // before giving up so the build doesn't wedge on "Downloading…".
  let data: Record<string, Record<string, unknown>>;
  try {
    data = await fetchJson(URL_ALL, 30000);
  } catch {
    onProgress?.('Retrying player directory download…');
    data = await fetchJson(URL_ALL, 45000);
  }
  onProgress?.('Processing players…');
  if (db) await idbSet(db, KEY, { ts: Date.now(), data });
  mem = parse(data);
  return mem;
}
