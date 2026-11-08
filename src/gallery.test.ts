import { test, expect } from 'bun:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractArtifacts, imageSources, pageContent } from './artifacts';
import { Library, scanSession, readChatRoots } from './library';
import { parseManifestJson } from '@openchamber/sdk/schemas';

const tool = (name: string, input: any, extra: any = {}) => ({ type: 'tool', id: 'call-1', name, state: { status: 'completed', input, metadata: { openchamber: { ok: true } }, ...extra } });
const message = (content: any[], id = 'msg_1') => ({ id, type: 'assistant', time: { created: 1 }, content });
const render = (html = '<h1>Carte</h1>') => tool('openchamber_render', { action: 'render.page', parameters: { html } });

test('the extension declares only sessions and its local service, and ships a valid page', async () => {
  const parsed = parseManifestJson(await readFile(join(import.meta.dir, '../package.json'), 'utf8'));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.manifest.contributes.capabilities).toEqual(['sessions']);
  expect(parsed.manifest.contributes.page).toBe(true);
});

test('only accepted render calls and explicit deliverables enter the gallery', () => {
  const parts = [render(), tool('openchamber_render', { html: '<h1>Rejected</h1>' }, { metadata: {} }), tool('shell', { html: '<h1>Not a page</h1>' }),
    { type: 'text', text: '[Budget](reports/budget.csv) [Code](src/index.ts)\n```md\n[Example](fake.pdf)\n```' }];
  const results = extractArtifacts(message(parts), 'ses_1', '/project');
  expect(results.map(a => [a.kind, a.title, a.path])).toEqual([['page', 'Carte', undefined], ['table', 'Budget', '/project/reports/budget.csv']]);
  expect(JSON.stringify(results)).not.toContain('<h1>');
  expect(pageContent(tool('openchamber_render', { html: '<h1>Ignored</h1>', parameters: { title: 'No HTML' } }))).toBeNull();
});

test('saved answers stay attached, interrupted questions remain viewable', () => {
  const part = render(); part.state.metadata.openchamber.answer = { answered: true, data: { choice: 'a' } };
  expect(pageContent(part)?.answer).toEqual({ choice: 'a' });
  expect(pageContent(tool('openchamber_render', { html: '<p>Question</p>', awaitAnswer: true }, { status: 'error' }))?.html).toContain('Question');
});

test('attachments retain a source reference, never their encoded content', () => {
  const rows = extractArtifacts({ id: 'msg_upload', type: 'user', files: [{ data: 'aGVsbG8=', mime: 'image/png', source: {}, name: 'Capture.png' }] }, 'ses_1', '/project');
  expect(rows[0].attachment).toBe(true);
  expect(rows[0].kind).toBe('image');
  expect(JSON.stringify(rows)).not.toContain('aGVsbG8=');
});

test('pagination includes old pages and resolves each side of a moved session', async () => {
  const recent = message([{ type: 'text', text: '[New](report.md)' }], 'msg_new');
  const old = message([{ type: 'text', text: '[Old](report.md)' }], 'msg_old');
  const result = await scanSession({ id: 'ses_1', title: 'Moved', time: { updated: 2 }, location: { directory: '/new' } }, async path => path.includes('cursor=next')
    ? { data: [old], cursor: {} }
    : { data: [recent, { type: 'location-switched', previous: { location: { directory: '/old' } } }], cursor: { next: 'next' } });
  expect(result.artifacts.map(a => a.path)).toEqual(['/new/report.md', '/old/report.md']);
});

test('repeated pagination fails rather than looping or declaring an incomplete index ready', async () => {
  await expect(scanSession({ id: 'ses_1' }, async () => ({ data: [], cursor: { next: 'same' } }))).rejects.toThrow('Pagination');
});

test('images match native quoted paths and CSS references without scanning unrelated paths', () => {
  expect(imageSources(`<img src="/shots/a b.png"><style>x{background:url(/shots/c.webp)}</style><script>let a='/shots/a b.png';let other='/secret.txt'</script>`)).toEqual(['/shots/a b.png', '/shots/c.webp']);
});

test('index is metadata-only, refresh preserves failures, preview reads the current source', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gallery-test-'));
  try {
    const document = join(dir, 'report.md');
    await writeFile(document, 'First version');
    let source: any = message([render('<h1>Private HTML body</h1>'), { type: 'text', text: `[Report](${document})` }]);
    let failed = false, updated = 1, scans = 0;
    const api = async (path: string) => {
      if (path === '/api/project') return [];
      if (path.startsWith('/api/session?')) return { data: [{ id: 'ses_1', title: 'Session', location: { directory: dir }, time: { updated } }], cursor: {} };
      if (path.includes('/message?')) { scans++; if (failed) throw Error('Offline'); return { data: [source], cursor: {} }; }
      if (path.includes('/message/')) { if (!source) throw Error('Deleted'); return { data: source }; }
      return { data: { id: 'ses_1' } };
    };
    const library = new Library(async () => api);
    await library.sync([]); await library.settled();
    expect(library.list()).toHaveLength(2);
    const persisted = JSON.stringify(library.snapshot());
    expect(persisted).not.toContain('<h1>'); expect(persisted).not.toContain('First version');
    await library.sync([]); await library.settled(); expect(scans).toBe(1);
    expect(JSON.stringify(library.snapshot())).toBe(persisted);
    const restored = new Library(async () => api); restored.restore(JSON.parse(persisted));
    await restored.sync([]); await restored.settled(); expect(scans).toBe(1);
    restored.restore({ version: 1, sessions: [] }); expect(restored.list()).toHaveLength(2);
    failed = true; updated = 2; await library.sync([]); await library.settled();
    expect(library.status.failed).toBe(1); expect(library.list()).toHaveLength(2);
    const file = library.list().find(a => a.path)!;
    await writeFile(document, 'Updated version');
    const preview = await library.preview(file.id);
    const resource = (preview as any).resource;
    expect(Buffer.from(library.resource(resource.key, 0).data, 'base64').toString()).toBe('Updated version');
    expect(() => library.resource(resource.key, 0)).toThrow('expiré');
    await rm(document); await expect(library.preview(file.id)).rejects.toThrow('introuvable');
    source = message([]); await expect(library.preview(file.id)).rejects.toThrow('message source');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('scoped index separates managed Chats from unknown sources and replaces pages', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gallery-scopes-'));
  try {
    const infos = [
      { id: 'ses_project', title: 'Project', location: { directory: '/work/one' }, time: { updated: 1 } },
      { id: 'ses_chat', title: 'Chat', location: { directory: '/canonical/chats/day/thread' }, time: { updated: 1 } },
      { id: 'ses_unknown', title: 'Unknown', location: { directory: null }, time: { updated: 1 } },
      { id: 'ses_neighbor', title: 'Neighbor', location: { directory: '/canonical/chats-other/thread' }, time: { updated: 1 } },
    ];
    const api = async (path: string) => path === '/api/project' ? [] : path.startsWith('/api/session?') ? { data: infos, cursor: {} }
      : path.includes('/message?') ? { data: [message(Array.from({ length: path.includes('ses_project') ? 30 : 1 }, (_, i) => ({ ...render(`<h1>Artifact ${i}</h1>`), id: `call-${i}` })))], cursor: {} } : {};
    const library = new Library(async () => api, async () => ['/configured/chats', '/canonical/chats']);
    await library.sync([{ id: 'p1', name: 'One', directory: '/work/one' }], undefined, 'http://127.0.0.1:1234'); await library.settled();
    const params = new URLSearchParams({ scope: 'all', project: 'chats', session: 'ses_project', size: '12' });
    const chats = library.index(params);
    expect(chats.total).toBe(1); expect(chats.artifacts?.[0].sessionId).toBe('ses_chat');
    expect(chats.context.space.id).toBe('p1');
    params.set('project', 'projects');
    const first = library.index(params);
    expect(first.total).toBe(30); expect(first.artifacts).toHaveLength(12);
    params.set('page', '2'); const second = library.index(params);
    expect(second.artifacts).toHaveLength(12);
    expect(second.artifacts?.some(row => first.artifacts?.some(previous => previous.id === row.id))).toBe(false);
    params.set('version', second.version);
    expect(library.index(params).artifacts).toBeUndefined();
    params.set('scope', 'session'); params.set('session', 'ses_empty');
    expect(library.index(params).total).toBe(0);
    params.set('scope', 'all'); params.set('project', 'all');
    expect(library.index(params).total).toBe(33);
    params.set('scope', 'space'); params.set('session', 'ses_unknown');
    expect(library.index(params).total).toBe(0);
    params.set('size', '100000'); expect(() => library.index(params)).toThrow('Filtres');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Chats roots come from the local host, including canonical aliases, without remote redirects', async () => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    expect(new URL(req.url).pathname).toBe('/api/fs/home');
    return Response.json({ home: '/home/user', chatsRoot: '/custom/chats/', canonicalChatsRoot: '/disk/chats', canonicalLegacyChatsRoot: '/disk/legacy' });
  } });
  try {
    expect(await readChatRoots(server.url.origin)).toEqual(['/custom/chats', '/home/user/.config/openchamber/chats', '/disk/chats', '/disk/legacy']);
    await expect(readChatRoots('https://8.8.8.8')).rejects.toThrow('locale');
    await expect(readChatRoots(server.url.origin + '/another-route')).rejects.toThrow('locale');
  } finally { server.stop(true); }
});
