import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

/** `node:sqlite` is a built-in only on newer Node; import it lazily so an older runtime falls back. */
async function loadSqlite(): Promise<any> {
  try { return (await import('node:sqlite')).DatabaseSync; }
  catch { return null; }
}

/**
 * Reads OpenChamber's own OpenCode store straight from its SQLite database.
 *
 * The gallery used to reach a standalone OpenCode through `Service.discover()`,
 * which reads `~/.local/state/opencode/service.json`. Under OpenChamber that file
 * belongs to a different OpenCode instance, so the gallery only ever saw a couple
 * of unrelated sessions. OpenChamber keeps its sessions in
 * `<XDG_DATA_HOME>/opencode/opencode.db`, which the gallery service inherits in
 * its environment; reading it directly needs no credentials and survives the
 * host rotating the managed server password.
 */

type Page = { data: any[]; cursor: {} };

export function openChamberDatabase(): string | null {
  const dataHome = process.env.OPENCHAMBER_OC_DATA_HOME || process.env.XDG_DATA_HOME;
  const candidates = [
    dataHome ? join(dataHome, 'opencode', 'opencode.db') : null,
    join(homedir(), '.local', 'share', 'opencode', 'opencode.db'),
  ].filter((path): path is string => Boolean(path));
  return candidates.find(path => existsSync(path)) ?? null;
}

const projectColumns = (db: any) => new Set((db.prepare('pragma table_info(project)').all() as any[]).map(row => row.name));

/** Map a `session_v2` row to the shape the gallery expects from `/api/session`. */
function sessionInfo(row: any): any {
  const archived = row.time_archived != null;
  return {
    id: row.id,
    projectID: row.project_id ?? null,
    title: row.title || row.id,
    location: { directory: row.directory ?? null },
    time: { created: row.time_created ?? 0, updated: row.time_updated ?? 0, ...(archived ? { archived: row.time_archived } : {}) },
    archivedAt: archived ? row.time_archived : null,
    archived,
  };
}

/** Map a `session_message` row back to the message JSON the gallery parses. */
function messageFrom(row: any): any {
  let data: any;
  try { data = JSON.parse(row.data); } catch { data = {}; }
  if (!data || typeof data !== 'object') data = {};
  // The gallery reads `type`/`id` from the message itself, as the HTTP API exposed them.
  return { ...data, id: row.id, type: row.type };
}

export type DatabaseReader = {
  api: (path: string) => Promise<any>;
  close: () => void;
};

export async function databaseReader(database: string): Promise<DatabaseReader | null> {
  const DatabaseSync = await loadSqlite();
  if (!DatabaseSync) return null;
  const db = new DatabaseSync(database, { readOnly: true });
  const projects = projectColumns(db);
  const projectPath = projects.has('worktree') ? 'worktree' : projects.has('canonical') ? 'canonical' : 'worktree';

  const sessionById = db.prepare('select * from session_v2 where id = ?');
  const projectRows = db.prepare(`select id, ${projectPath} as canonical from project`).all() as any[];
  const messagePage = db.prepare('select id, type, seq, data from session_message where session_id = ? order by seq desc limit ? offset ?');
  const messageCount = db.prepare('select count(*) as n from session_message where session_id = ?');
  const messageBySeq = db.prepare('select id, type, seq, data from session_message where session_id = ? and seq = ? limit 1');
  const messageById = db.prepare('select id, type, seq, data from session_message where session_id = ? and id = ? limit 1');

  const listSessions = (limit: number, offset: number) => {
    const rows = db.prepare(`select * from session_v2 order by time_updated desc limit ? offset ?`).all(limit, offset + 0) as any[];
    return rows.map(sessionInfo);
  };
  const sessionTotal = (db.prepare('select count(*) as n from session_v2').get() as any).n as number;

  const api = async (path: string): Promise<any> => {
    const url = new URL(path, 'http://local');
    const parts = url.pathname.split('/').filter(Boolean); // ['api', 'session', id?, 'message', msgId?]
    if (parts[1] === 'project') return projectRows.map(row => ({ id: row.id, canonical: row.canonical }));
    if (parts[1] !== 'session') throw new Error(`Unknown store path: ${path}`);

    // /api/session  (list)
    if (parts.length === 2) {
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 100)));
      const cursor = url.searchParams.get('cursor');
      const offset = cursor ? Math.max(0, Number(cursor) || 0) : 0;
      const data = listSessions(limit, offset);
      const next = offset + data.length < sessionTotal ? String(offset + data.length) : '';
      return { data, cursor: next ? { next } : {} } as Page;
    }

    const sessionId = decodeURIComponent(parts[2] ?? '');

    // /api/session/{id}
    if (parts.length === 3) {
      const row = sessionById.get(sessionId) as any;
      if (!row) throw Object.assign(new Error('session not found'), { status: 404 });
      return { data: sessionInfo(row) };
    }

    // /api/session/{id}/message?...
    if (parts[3] === 'message' && parts.length === 4) {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 25)));
      const cursor = url.searchParams.get('cursor');
      const offset = cursor ? Math.max(0, Number(cursor) || 0) : 0;
      const total = (messageCount.get(sessionId) as any).n as number;
      const rows = messagePage.all(sessionId, limit, offset) as any[];
      const next = offset + rows.length < total ? String(offset + rows.length) : '';
      return { data: rows.map(messageFrom), cursor: next ? { next } : {} } as Page;
    }

    // /api/session/{id}/message/{messageId}
    if (parts[3] === 'message' && parts.length === 5) {
      const messageId = decodeURIComponent(parts[4] ?? '');
      const row = (messageById.get(sessionId, messageId) as any) ?? (messageBySeq.get(sessionId, Number(messageId)) as any);
      if (!row) throw Object.assign(new Error('message not found'), { status: 404 });
      return { data: messageFrom(row) };
    }

    throw new Error(`Unknown store path: ${path}`);
  };

  return { api, close: () => { try { db.close(); } catch { /* already closed */ } } };
}
