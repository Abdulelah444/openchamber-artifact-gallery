import type { Artifact } from './artifacts';

export type CachedSession = { id: string; title: string; directory: string | null; projectId: string | null; updated: number; archived: boolean; directoryFiles?: boolean; artifacts: Artifact[] };
export type Snapshot = { version: 1; sessions: CachedSession[] };
// Two generations, JSON escaping and preferences must fit below the host's 2 MiB quota.
export const CACHE_BYTES = 400 * 1024, CHUNK_BYTES = 48 * 1024;
export const cachePrefix = 'gallery-index:', manifestKey = cachePrefix + 'manifest';
const encoder = new TextEncoder();
export const jsonBytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length;
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 4096;
const nullable = (v: unknown) => v === null || text(v);
const timestamp = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 8.64e15;

export function validateSnapshot(value: any): Snapshot {
  if (!value || value.version !== 1 || !Array.isArray(value.sessions) || jsonBytes(value) > CACHE_BYTES) throw Error('Invalid cache');
  const ids = new Set<string>();
  for (const s of value.sessions) {
    if (!s || !text(s.id) || !/^(?:ses_|fs_)[\w-]+$/.test(s.id) || ids.has(s.id) || !text(s.title) || !nullable(s.directory) || !nullable(s.projectId) || !timestamp(s.updated) || !Array.isArray(s.artifacts) || (s.archived !== undefined && typeof s.archived !== 'boolean') || (s.directoryFiles !== undefined && typeof s.directoryFiles !== 'boolean')) throw Error('Invalid cached session');
    ids.add(s.id);
    for (const a of s.artifacts) {
      if (!a || !text(a.id) || !/^[a-f0-9]{64}$/.test(a.id) || a.sessionId !== s.id || !text(a.messageId) || !text(a.partId) || !Number.isSafeInteger(a.position) || a.position < 0 || !text(a.title) || !['page', 'image', 'document', 'table'].includes(a.kind) || !text(a.format) || !text(a.origin) || !timestamp(a.createdAt) || !nullable(a.directory) || a.path !== undefined && !text(a.path) || a.attachment !== undefined && typeof a.attachment !== 'boolean' || a.discovered !== undefined && typeof a.discovered !== 'boolean') throw Error('Invalid cached artifact');
    }
  }
  // Strip unknown fields: a cache must never become a second source-content store.
  return { version: 1, sessions: value.sessions.map((s: CachedSession) => ({ id: s.id, title: s.title, directory: s.directory, projectId: s.projectId, updated: s.updated, ...(s.archived ? { archived: true } : {}), ...(s.directoryFiles ? { directoryFiles: true } : {}), artifacts: s.artifacts.map(a => ({ id: a.id, sessionId: a.sessionId, messageId: a.messageId, partId: a.partId, position: a.position, title: a.title, kind: a.kind, format: a.format, origin: a.origin, createdAt: a.createdAt, directory: a.directory, ...(a.path === undefined ? {} : { path: a.path }), ...(a.attachment === undefined ? {} : { attachment: a.attachment }), ...(a.discovered ? { discovered: true } : {}) })) })) };
}

export function boundedSnapshot(sessions: Iterable<CachedSession>): Snapshot {
  let bytes = jsonBytes({ version: 1, sessions: [] });
  const kept: CachedSession[] = [];
  for (const session of [...sessions].sort((a, b) => b.updated - a.updated || a.id.localeCompare(b.id))) {
    const size = jsonBytes(session) + (kept.length ? 1 : 0);
    if (bytes + size <= CACHE_BYTES) { kept.push(session); bytes += size; }
  }
  return { version: 1, sessions: kept };
}

export function chunksFor(snapshot: Snapshot): string[] {
  const chunks: string[] = []; let chunk = '', bytes = 2;
  for (const char of JSON.stringify(validateSnapshot(snapshot))) {
    const size = jsonBytes(char) - 2;
    if (bytes + size > CHUNK_BYTES) { chunks.push(chunk); chunk = ''; bytes = 2; }
    chunk += char; bytes += size;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

type Storage = { get(key: string): Promise<any>; set(key: string, value: any): Promise<unknown>; delete(key: string): Promise<unknown>; keys(): Promise<string[]> };
type CacheRequest = (path: string, body?: unknown) => Promise<any>;

// Opaque guest frames cannot use Web Locks. A renewable service lease serializes panels.
export async function withCacheLease<S extends Storage, T>(storage: S, request: CacheRequest, disposed: () => boolean, action: (storage: S, owner: string, renew: () => Promise<void>) => Promise<T>): Promise<T> {
  const owner = crypto.randomUUID(), path = '/cache-lock?owner=' + owner;
  const acquire = async () => (await request(path, {})).acquired === true;
  try {
    while (!await acquire()) {
      if (disposed()) throw Error('Panel closed');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    let lost = false;
    const renew = async () => {
      try { if (lost || disposed() || (await request(path + '&renew=1', {})).acquired !== true) throw Error('Cache lease lost'); }
      catch (error) { lost = true; throw error; }
    };
    return await action({
      ...storage,
      get: async (...args: [string]) => { await renew(); return storage.get(...args); },
      set: async (...args: [string, any]) => { await renew(); return storage.set(...args); },
      delete: async (...args: [string]) => { await renew(); return storage.delete(...args); },
      keys: async () => { await renew(); return storage.keys(); },
    }, owner, renew);
  } finally { if (!disposed()) await request(path + '&release=1', {}).catch(() => {}); }
}

export async function persistCache(storage: Storage, saved: { running: boolean; collected?: boolean; snapshot: Snapshot }, restored: boolean): Promise<boolean> {
  if (saved.running) return true;
  if (!restored && saved.collected !== true) throw Error('Cache not rebuilt');
  await writeCache(storage, saved.snapshot);
  return false;
}

type Manifest = { version: 1; generation: string; count: number; bytes: number };
function manifest(value: any): Manifest {
  if (!value || value.version !== 1 || typeof value.generation !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value.generation) || !Number.isInteger(value.count) || value.count < 1 || value.count > 40 || !Number.isInteger(value.bytes) || value.bytes < 1 || value.bytes > CACHE_BYTES) throw Error('Invalid cache manifest');
  return value;
}
const keyFor = (m: Manifest, i: number) => `${cachePrefix}${m.generation}:${i}`;

export async function readCache(storage: Storage): Promise<Snapshot | null> {
  const saved = await storage.get(manifestKey);
  if (saved == null) return null;
  const m = manifest(saved), chunks: string[] = [];
  for (let i = 0; i < m.count; i++) {
    const chunk = await storage.get(keyFor(m, i));
    if (typeof chunk !== 'string' || jsonBytes(chunk) > CHUNK_BYTES) throw Error('Incomplete cache');
    chunks.push(chunk);
  }
  const joined = chunks.join('');
  if (encoder.encode(joined).length !== m.bytes) throw Error('Incomplete cache');
  return validateSnapshot(JSON.parse(joined));
}

// Call under the service's shared lease. Commit the manifest last; this is not a transaction.
export async function writeCache(storage: Storage, snapshot: Snapshot): Promise<void> {
  const chunks = chunksFor(snapshot), oldKeys = (await storage.keys()).filter(key => key.startsWith(cachePrefix) && key !== manifestKey);
  const m: Manifest = { version: 1, generation: crypto.randomUUID(), count: chunks.length, bytes: encoder.encode(chunks.join('')).length };
  // Remove abandoned generations before staging, but preserve the last committed one.
  const saved = await storage.get(manifestKey);
  let previous: Manifest | null = null;
  try { if (saved != null) previous = manifest(saved); } catch {}
  const previousKeys = new Set(previous ? Array.from({ length: previous.count }, (_, i) => keyFor(previous!, i)) : []);
  for (const key of oldKeys) if (!previousKeys.has(key)) await storage.delete(key);
  try {
    for (let i = 0; i < chunks.length; i++) await storage.set(keyFor(m, i), chunks[i]);
    await storage.set(manifestKey, m);
  } catch (error) {
    // A lost acknowledgement may follow a successful commit: reconcile before cleanup.
    let current;
    try { current = await storage.get(manifestKey); } catch { throw error; }
    if (current?.generation !== m.generation) {
      for (let i = 0; i < chunks.length; i++) await storage.delete(keyFor(m, i)).catch(() => {});
      throw error;
    }
  }
  for (const key of previousKeys) await storage.delete(key);
}
