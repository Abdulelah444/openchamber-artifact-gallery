import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Library, GalleryError } from './library';
import { CACHE_BYTES, CHUNK_BYTES, jsonBytes } from './cache';
import { isGalleryHostname, ownHostnames } from './origin';
import os from 'node:os';

const own = ownHostnames(os);
import { readProjectIcon } from './project-icon';

const port = Number(process.env.OPENCHAMBER_SERVICE_PORT), token = process.env.OPENCHAMBER_SERVICE_TOKEN;
if (!Number.isInteger(port) || port < 1 || !token) throw Error('OpenChamber service environment required.');
const library = new Library();
let iconOrigin = '', iconProjects = new Set<string>();
let cacheLease = { owner: '', expires: 0 };
let restoreUpload: { owner: string; count: number; chunks: string[]; bytes: number } | null = null;
const reply = (res: http.ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
};
const server = http.createServer(async (req, res) => {
  const actual = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${token}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reply(res, 401, { error: 'Accès refusé.' });
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/health') return reply(res, 200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/index') return reply(res, 200, library.index(url.searchParams));
    if (req.method === 'GET' && url.pathname === '/project-icon') {
      const id = url.searchParams.get('id') ?? '', theme = url.searchParams.get('theme') ?? 'dark';
      if (!iconProjects.has(id) || !iconOrigin || url.searchParams.get('origin') !== iconOrigin) return reply(res, 200, null);
      return reply(res, 200, await readProjectIcon(iconOrigin, id, theme));
    }
    if (req.method === 'POST' && url.pathname === '/cache-lock') {
      const owner = url.searchParams.get('owner') ?? '';
      if (!/^[a-f0-9-]{36}$/.test(owner)) throw new GalleryError(400, 'Requête invalide.');
      if (url.searchParams.has('release')) {
        if (cacheLease.owner === owner) { cacheLease = { owner: '', expires: 0 }; restoreUpload = null; }
        return reply(res, 200, { acquired: false });
      }
      const valid = cacheLease.expires > Date.now();
      const acquired = url.searchParams.has('renew') ? valid && cacheLease.owner === owner : !valid || cacheLease.owner === owner;
      if (acquired) { if (!valid || cacheLease.owner !== owner) restoreUpload = null; cacheLease = { owner, expires: Date.now() + 60_000 }; }
      return reply(res, 200, { acquired });
    }
    if (req.method === 'GET' && url.pathname === '/cache') {
      if (library.status.running) return reply(res, 202, { running: true });
      await library.settled();
      return reply(res, 200, { running: false, collected: library.status.refreshedAt > 0 && !library.status.error && !library.status.failed, snapshot: library.snapshot() });
    }
    if (req.method === 'POST' && url.pathname === '/cache') {
      const chunks = []; let size = 0;
      for await (const chunk of req.iterator({ destroyOnReturn: false })) { size += chunk.length; if (size > 64_000) throw new GalleryError(413, 'Requête trop volumineuse.'); chunks.push(chunk); }
      try {
        const part = JSON.parse(Buffer.concat(chunks).toString());
        if (!part || part.owner !== cacheLease.owner || cacheLease.expires < Date.now() || !Number.isInteger(part.count) || part.count < 1 || part.count > 40 || !Number.isInteger(part.index) || part.index < 0 || part.index >= part.count || typeof part.data !== 'string' || jsonBytes(part.data) > CHUNK_BYTES) throw Error('Invalid cache upload');
        if (part.index === 0) restoreUpload = { owner: part.owner, count: part.count, chunks: [], bytes: 0 };
        const upload = restoreUpload;
        if (!upload || upload.owner !== part.owner || upload.count !== part.count || upload.chunks.length !== part.index) throw Error('Invalid cache upload');
        upload.bytes += Buffer.byteLength(part.data);
        if (upload.bytes > CACHE_BYTES) throw Error('Cache too large');
        upload.chunks.push(part.data);
        if (upload.chunks.length === upload.count) { library.restore(JSON.parse(upload.chunks.join(''))); restoreUpload = null; }
      } catch { restoreUpload = null; throw new GalleryError(400, 'Index local invalide.'); }
      return reply(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/item' && /^[a-f0-9]{64}$/.test(url.searchParams.get('id') ?? '')) return reply(res, 200, library.item(url.searchParams.get('id')!));
    if (req.method === 'GET' && url.pathname === '/hidden') return reply(res, 200, { ids: library.hiddenList() });
    if (req.method === 'POST' && url.pathname === '/hidden') {
      const chunks = []; let size = 0;
      for await (const chunk of req.iterator({ destroyOnReturn: false })) { size += chunk.length; if (size > 256_000) throw new GalleryError(413, 'Requête trop volumineuse.'); chunks.push(chunk); }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new GalleryError(400, 'Requête invalide.'); }
      if (!body || !Array.isArray(body.ids) || body.ids.length > 20_000 || body.ids.some((id: unknown) => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))) throw new GalleryError(400, 'Requête invalide.');
      library.setHidden(body.ids);
      return reply(res, 200, { ok: true, count: library.hidden.size });
    }
    if (req.method === 'POST' && url.pathname === '/delete') {
      const chunks = []; let size = 0;
      for await (const chunk of req.iterator({ destroyOnReturn: false })) { size += chunk.length; if (size > 64_000) throw new GalleryError(413, 'Requête trop volumineuse.'); chunks.push(chunk); }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new GalleryError(400, 'Requête invalide.'); }
      if (!body || !Array.isArray(body.ids) || !body.ids.length || body.ids.length > 500 || body.ids.some((id: unknown) => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))) throw new GalleryError(400, 'Requête invalide.');
      return reply(res, 200, await library.remove(body.ids));
    }
    if (req.method === 'POST' && url.pathname === '/sync') {
      const chunks = []; let size = 0;
      for await (const chunk of req.iterator({ destroyOnReturn: false })) { size += chunk.length; if (size > 64_000) throw new GalleryError(413, 'Requête trop volumineuse.'); chunks.push(chunk); }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new GalleryError(400, 'Requête invalide.'); }
      const hostInvalid = body.hostOrigin !== undefined && (typeof body.hostOrigin !== 'string' || !/^https?:\/\//.test(body.hostOrigin) || (() => { try { const o = new URL(body.hostOrigin); return o.origin !== body.hostOrigin || o.username || o.password || !isGalleryHostname(o.hostname, own); } catch { return true; } })());
      if (!body || !Array.isArray(body.projects) || body.projects.length > 200 || body.projects.some((p: any) => !p || ['id', 'name', 'directory'].some(k => typeof p[k] !== 'string' || p[k].length > 2048)) || body.sessionId && !/^ses_[a-zA-Z0-9_-]+$/.test(body.sessionId) || hostInvalid) throw new GalleryError(400, 'Projets, session ou hôte invalides.');
      iconOrigin = body.hostOrigin ?? ''; iconProjects = new Set(body.projects.map((p: any) => p.id));
      await library.sync(body.projects.map(({ id, name, directory }: any) => ({ id, name, directory })), body.sessionId, body.hostOrigin);
      return reply(res, 202, { status: library.status });
    }
    if (req.method === 'GET' && url.pathname === '/preview' && /^[a-f0-9]{64}$/.test(url.searchParams.get('id') ?? '')) return reply(res, 200, await library.preview(url.searchParams.get('id')!));
    if (req.method === 'GET' && url.pathname === '/resource' && /^[a-f0-9-]{36}$/.test(url.searchParams.get('key') ?? '')) return reply(res, 200, library.resource(url.searchParams.get('key')!, Number(url.searchParams.get('offset') ?? 0)));
    reply(res, 404, { error: 'Requête inconnue.' });
  } catch (error) {
    // Drain rejected uploads without destroying the socket before the response is sent.
    if (error instanceof GalleryError && error.status === 413) { res.setHeader('connection', 'close'); req.resume(); }
    reply(res, error instanceof GalleryError ? error.status : 500, { error: error instanceof GalleryError ? error.message : 'Lecture impossible. Réessaie depuis la galerie.' });
  }
});
server.requestTimeout = 30_000;
server.listen(port, '127.0.0.1');
