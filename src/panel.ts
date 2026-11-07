import { connectHost, type HostReadyContext, type AttachIssueRequest } from '@openchamber/sdk';
import { applyHostReady, mountButton, mountSearchField, mountSelect } from '@openchamber/sdk/ui';
import { fontCss, previewDocument, previewThemeMessage } from './preview';
import type { Library } from './library';
import { locale, setLocale, t, type Language } from './locale';
import { chunksFor, readCache, persistCache, withCacheLease } from './cache';
import { ProjectIcons } from './project-icons';

type Item = ReturnType<Library['list']>[number];
type Index = ReturnType<Library['index']>;
type Preferences = { previews: 'visible' | 'manual'; density: 'comfortable' | 'compact'; pageSize: 12 | 24; automatic: boolean; projectIcons: boolean; language: Language };
const host = connectHost(), app = document.getElementById('app')!;
// Embedded fonts also work behind the host's per-document guest asset token.
const fonts = document.createElement('style'); fonts.textContent = fontCss; document.head.append(fonts);
const el = (tag: string, className = '', text = '') => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; };
const button = (label: string, action: () => void, className = '') => { const node = document.createElement('button'); node.type = 'button'; node.className = className; node.textContent = label; node.onclick = action; return node; };
const kinds: Record<string, string> = { page: 'Pages inline', image: 'Images', document: 'Documents', table: 'Tableaux' };
let context: HostReadyContext, initialized = false, mounted = false;
let items: Item[] = [], spaces: NonNullable<Index['spaces']> = [], result: Index | null = null;
let scope: 'session' | 'space' | 'all' = 'session', project = 'all', type = 'all', query = '', page = 1;
let settings: Preferences = { previews: 'visible', density: 'comfortable', pageSize: 12, automatic: true, projectIcons: true, language: 'auto' };
const projectIcons = new ProjectIcons(request);
let iconProjects = new Set<string>();
let lastSync = 0, refreshing = false, fetching = false, pending = false, viewEpoch = 0, version = '', generation = 0;
let timer: ReturnType<typeof setTimeout>, searchTimer: ReturnType<typeof setTimeout>, contextTimer: ReturnType<typeof setTimeout>;
let saveQueue = Promise.resolve(), pendingFocus = '';
let pendingItem: string | null = null;
let modalVersion = 0, activePreview: HTMLIFrameElement | null = null;
let detail: Item | null = null;
let cacheReady = false, cacheRestored = false, cacheSaving = false, disposed = false, cacheWarning = '';
let cacheTimer: ReturnType<typeof setTimeout>;

function withCacheStorage<T>(action: (storage: typeof host.storage, owner: string, renew: () => Promise<void>) => Promise<T>): Promise<T> {
  return withCacheLease(host.storage, request, () => disposed, action);
}
function cacheFailed() { cacheWarning = 'Cache indisponible : mode mémoire, reconstruction depuis les sources.'; renderStatus(); }
async function persistWhenSettled() {
  if (cacheSaving || disposed) return;
  cacheSaving = true; clearTimeout(cacheTimer);
  try {
    const running = await withCacheStorage(async storage => {
      const saved = await request('/cache');
      return persistCache(storage, saved, cacheRestored);
    });
    if (running) { cacheTimer = setTimeout(() => void persistWhenSettled(), 1500); return; }
    cacheWarning = ''; renderStatus();
  } catch { cacheFailed(); }
  finally { cacheSaving = false; }
}
const header = el('header', 'toolbar'), actions = el('div', 'toolbar-actions'), scopes = el('div', 'scope-tabs'), scopeContext = el('div', 'scope-context');
const layout = el('div', 'gallery-layout'), explorer = el('nav', 'explorer'), work = el('div', 'gallery-work'), controls = el('div', 'controls');
const notice = el('p', 'notice'), errorLine = el('p', 'error'), content = el('section', 'content'), destination = el('p', 'destination');
notice.setAttribute('role', 'status'); errorLine.setAttribute('role', 'alert'); content.setAttribute('aria-label', 'Artefacts'); explorer.setAttribute('aria-label', 'Explorer les espaces');
scopes.setAttribute('role', 'group'); scopes.setAttribute('aria-label', 'Portée de la galerie');
const dialog = document.createElement('dialog'); dialog.className = 'preview-dialog'; dialog.setAttribute('aria-labelledby', 'preview-title');
const projectMenu = el('div', 'project-menu'); projectMenu.setAttribute('popover', 'auto');
const exploreButton = button('Explorer', () => projectMenu.showPopover(), 'plain-button explore-button');
projectMenu.addEventListener('toggle', () => renderSpaces(projectMenu));
let search: ReturnType<typeof mountSearchField>, typePicker: ReturnType<typeof mountSelect>, settingsButton: ReturnType<typeof mountButton>, refreshButton: ReturnType<typeof mountButton>;

// Bound source reads across thumbnails and the expanded preview, including resource chunks.
let reads = 0; const waiters: (() => void)[] = [];
async function request(path: string, body?: unknown) {
  const source = /^\/(preview|resource)\?/.test(path);
  if (source) { if (reads >= 2) await new Promise<void>(resolve => waiters.push(resolve)); else reads++; }
  try {
    const response = await host.serviceRequest({ method: body === undefined ? 'GET' : 'POST', path, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
    if (response.status < 200 || response.status >= 300) throw Error(t(data?.error || 'Lecture impossible ({status}).', { status: response.status }));
    return data;
  } finally { if (source) { const next = waiters.shift(); if (next) next(); else reads--; } }
}
function report(error: unknown) { errorLine.textContent = t(error instanceof Error ? error.message : 'Connexion indisponible.'); }
const closeDialog = () => dialog.close();
dialog.addEventListener('close', () => { modalVersion++; activePreview = null; detail = null; dialog.replaceChildren(); scheduleThumbnails(); });
dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeDialog(); } });

function filters() {
  return new URLSearchParams({ scope, project, type, q: query, page: String(page), size: String(settings.pageSize), ...(context.session ? { session: context.session.id } : {}), ...(context.directory ? { directory: context.directory } : {}) });
}
function resetFilters() { query = ''; type = 'all'; page = 1; search.update({ value: '' }); typePicker.update({ value: 'all' }); clearTimeout(searchTimer); }
function changeView() {
  viewEpoch++; version = ''; clearThumbnails(); content.replaceChildren(el('p', 'source-note', t('Chargement des références…')));
  renderChrome(); void loadIndex();
}
function setScope(value: typeof scope) { scope = value; if (value === 'all') project = 'all'; resetFilters(); changeView(); }
function setProject(value: string) { scope = 'all'; project = value; projectMenu.hidePopover(); resetFilters(); changeView(); }
function renderSpaces(root: HTMLElement) {
  root.replaceChildren(el('h2', '', t('Espaces')));
  const choices = [{ id: 'all', name: t('Tout'), count: result?.context.total ?? 0 }, { id: 'chats', name: 'Chats', count: spaces.find(p => p.id === 'chats')?.count ?? 0 }, { id: 'projects', name: t('Tous les projets'), count: result?.context.projectsCount ?? 0 }, ...spaces.filter(p => p.id !== 'chats').map(p => ({ ...p, name: p.kind === 'unknown' ? t('Sources non classées') : p.name }))];
  for (const space of choices) {
    const node = button('', () => setProject(space.id), 'space-button');
    node.setAttribute('aria-label', t('Explorer {name}', { name: space.name })); node.setAttribute('aria-pressed', String(scope === 'all' && project === space.id));
    const icon = el('span', 'space-icon', space.id === 'chats' ? '◌' : space.name.slice(0, 1).toLocaleUpperCase(locale)); icon.dataset.initial = icon.textContent ?? '';
    node.append(icon, el('span', 'space-name', space.name), el('span', 'space-count', String(space.count))); root.append(node);
    if (iconProjects.has(space.id) && (root !== projectMenu || projectMenu.matches(':popover-open'))) projectIcons.attach(icon, space.id);
  }
  projectIcons.prune();
}
function renderChrome() {
  if (!mounted) return;
  projectIcons.configure(settings.projectIcons, location.origin, context.theme.mode);
  document.documentElement.lang = locale; document.title = t('Galerie'); header.querySelector('h1')!.textContent = t('Galerie');
  content.setAttribute('aria-label', t('Artefacts')); explorer.setAttribute('aria-label', t('Explorer les espaces')); scopes.setAttribute('aria-label', t('Portée de la galerie'));
  exploreButton.textContent = t('Explorer'); settingsButton.update({ label: t('Réglages') }); refreshButton.update({ label: t('Actualiser') });
  actions.querySelector('.oc-sdk-btn')?.setAttribute('aria-label', t('Réglages de la galerie'));
  typePicker.update({ options: [{ id: 'all', label: t('Tous les types') }, ...Object.entries(kinds).map(([id, label]) => ({ id, label: t(label) }))] });
  controls.querySelector('.picker button')?.setAttribute('aria-label', t('Filtrer par type'));
  app.dataset.surface = context.surface; app.dataset.density = settings.density;
  const activeSpace = result?.context.space, middle = activeSpace?.kind === 'chats' ? 'Chats' : 'Projet';
  scopes.replaceChildren();
  for (const [id, label, count] of [['session', 'Session', result?.context.sessionCount], ['space', middle, result?.context.spaceCount], ['all', 'Tout', result?.context.total]] as const) {
    const node = button(t(label), () => setScope(id), 'scope-tab'); node.setAttribute('aria-label', t(label)); node.setAttribute('aria-pressed', String(scope === id));
    const number = el('span', 'scope-count', count === undefined ? '—' : String(count)); number.setAttribute('aria-hidden', 'true'); node.append(number); scopes.append(node);
  }
  const name = scope === 'session' ? context.session?.title ?? t('Aucune session active') : scope === 'space' ? (activeSpace?.kind === 'unknown' ? t('Sources non classées') : activeSpace?.name) ?? t('Espace en cours de lecture') : project === 'all' ? t('Chats et projets') : project === 'projects' ? t('Tous les projets') : project === 'chats' ? 'Chats' : project === 'unknown' ? t('Sources non classées') : spaces.find(p => p.id === project)?.name ?? t('Espace indisponible');
  scopeContext.replaceChildren(el('strong', '', name), el('span', '', t(scope === 'all' ? 'Exploration libre' : 'Suit la session active')));
  exploreButton.hidden = scope !== 'all';
  destination.textContent = context.session ? t('Ajout au brouillon · {title}', { title: context.session.title }) : t('Ouvre une conversation pour y ajouter une référence.');
  search.update({ label: t('Rechercher les artefacts'), placeholder: t(scope === 'session' ? 'Rechercher dans cette session…' : scope === 'space' ? middle === 'Chats' ? 'Rechercher dans Chats…' : 'Rechercher dans ce projet…' : 'Rechercher les artefacts…') });
  renderSpaces(explorer);
  renderStatus();
}
function mount() {
  header.append(el('h1', '', 'Galerie'), actions); actions.append(exploreButton);
  settingsButton = mountButton(actions, { label: t('Réglages'), variant: 'ghost', size: 'sm', onClick: openSettings });
  actions.lastElementChild?.setAttribute('aria-label', 'Réglages de la galerie');
  refreshButton = mountButton(actions, { label: t('Actualiser'), variant: 'ghost', size: 'sm', onClick: () => void refresh(true) });
  const searchSlot = el('div', 'search'), typeSlot = el('div', 'picker'); controls.append(searchSlot, typeSlot);
  search = mountSearchField(searchSlot, { value: '', label: 'Rechercher les artefacts', placeholder: 'Rechercher', onChange(value) { query = value.slice(0, 1000); search.update({ value: query }); page = 1; clearTimeout(searchTimer); searchTimer = setTimeout(changeView, 180); } });
  typePicker = mountSelect(typeSlot, { value: type, options: [{ id: 'all', label: 'Tous les types' }, ...Object.entries(kinds).map(([id, label]) => ({ id, label }))], onChange(value) { type = value; page = 1; typePicker.update({ value }); changeView(); } });
  typeSlot.querySelector('button')?.setAttribute('aria-label', 'Filtrer par type');
  work.append(controls, notice, errorLine, content); layout.append(explorer, work);
  app.replaceChildren(header, scopes, scopeContext, layout, destination, projectMenu, dialog); mounted = true; renderChrome();
}
async function loadIndex() {
  if (fetching) { pending = true; return; }
  fetching = true; const epoch = viewEpoch, params = filters(); if (version) params.set('version', version);
  try {
    const next: Index = await request('/index?' + params);
    if (epoch !== viewEpoch) return;
    result = next; version = next.version; page = next.page;
    if (!next.unchanged) { items = next.artifacts ?? []; spaces = next.spaces ?? []; renderChrome(); renderContent(); }
    const s = next.status;
    renderStatus();
    clearTimeout(timer);
    if (document.visibilityState === 'visible' && (s.running || settings.automatic)) timer = setTimeout(() => void refresh(), s.running ? 1500 : 15_000);
  } catch (error) { if (epoch === viewEpoch) report(error); }
  finally { fetching = false; if (pending) { pending = false; void loadIndex(); } }
}
function renderStatus() {
  if (!result) return;
  const s = result.status;
  notice.textContent = [t('{count} artefacts', { count: result.total }), t(settings.previews === 'manual' ? 'aperçus à la demande' : '6 aperçus maximum'), ...(s.running ? [t('collecte {done}/{total}', { done: s.done, total: s.total || '…' })] : []), ...(s.failed ? [t('{count} sessions non lues', { count: s.failed })] : [])].join(' · ');
  errorLine.textContent = [s.error, result.warning, cacheWarning].filter(Boolean).map(message => t(message)).join(' · ');
}
function updateLanguage() {
  if (!setLocale(context.locale, settings.language) || !mounted) return;
  renderChrome(); renderContent();
  if (dialog.open) { if (dialog.classList.contains('settings-dialog')) openSettings(); else if (detail) void openDetail(detail); }
}
async function refresh(force = false) {
  if (refreshing || !mounted || !cacheReady) return;
  clearTimeout(timer); refreshing = true;
  try {
    if (force || settings.automatic && Date.now() - lastSync > 45_000) {
      // Project names are a nicety; the store itself supplies every session and path,
      // so a not-yet-ready project list must not block the first collection.
      let snapshot: Awaited<ReturnType<typeof host.listProjects>> | null = null;
      try { snapshot = await host.listProjects(); } catch { snapshot = null; }
      const projects = snapshot?.state === 'ready' ? snapshot.projects : [];
      await request('/sync', { projects, sessionId: context.session?.id, hostOrigin: location.origin }); lastSync = Date.now();
      if (snapshot && snapshot.state === 'ready') {
        iconProjects = new Set(snapshot.projects.map(p => p.id));
        projectIcons.retain(iconProjects);
      } else timer = setTimeout(() => void refresh(true), 3000);
      void persistWhenSettled();
    }
    await loadIndex();
  } catch (error) { report(error); }
  finally { refreshing = false; }
}
function followContext() {
  if (!mounted) return;
  closeDialog(); resetFilters(); result = null; viewEpoch++; version = ''; clearThumbnails(); content.replaceChildren(); renderChrome();
  clearTimeout(contextTimer); contextTimer = setTimeout(() => void loadIndex(), 0);
}
document.addEventListener('visibilitychange', () => { if (!mounted) return; scheduleThumbnails(); if (document.visibilityState === 'visible') void refresh(); else clearTimeout(timer); });
window.addEventListener('pagehide', () => { disposed = true; projectIcons.clear(); clearTimeout(cacheTimer); clearTimeout(timer); clearTimeout(searchTimer); clearTimeout(contextTimer); clearThumbnails(); host.dispose(); });

const frameSizes = new ResizeObserver(entries => { for (const entry of entries) { const frame = entry.target.querySelector<HTMLIFrameElement>('.thumbnail-frame'); if (frame) frame.style.transform = `scale(${entry.contentRect.width / 720})`; } });
const observer = new IntersectionObserver(entries => { for (const entry of entries) (entry.target as HTMLElement).dataset.visible = String(entry.isIntersecting); scheduleThumbnails(); });
const active = new Set<HTMLElement>(), queue: HTMLElement[] = []; let loading = 0;
function unload(root: HTMLElement) { root.dataset.epoch = String(Number(root.dataset.epoch ?? 0) + 1); frameSizes.unobserve(root); root.replaceChildren(el('span', 'placeholder', root.dataset.format ?? '')); active.delete(root); }
function clearThumbnails() { generation++; observer.disconnect(); frameSizes.disconnect(); queue.length = 0; for (const root of active) unload(root); }
function scheduleThumbnails() {
  const visible = settings.previews === 'visible' && !dialog.open && document.visibilityState === 'visible' ? [...content.querySelectorAll<HTMLElement>('.thumbnail[data-visible="true"]')].slice(0, 6) : [];
  for (const root of active) if (!visible.includes(root)) unload(root);
  for (const root of visible) if (!active.has(root)) { active.add(root); queue.push(root); }
  void drain(); void drain();
}
async function drain() {
  if (loading >= 2) return;
  const root = queue.shift(); if (!root) return;
  if (!root.isConnected || !active.has(root)) { void drain(); return; }
  loading++; const epoch = root.dataset.epoch;
  try { const item = items.find(i => i.id === root.dataset.id); if (item) await display(root, item, false); }
  catch { if (root.isConnected && active.has(root) && root.dataset.epoch === epoch) root.replaceChildren(el('span', 'unavailable', t('Aperçu indisponible'))); }
  finally { loading--; void drain(); }
}
function dateLabel(date: Date) {
  const today = new Date(), yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  return date.toDateString() === today.toDateString() ? t('Aujourd’hui') : date.toDateString() === yesterday.toDateString() ? t('Hier') : date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}
function renderContent() {
  clearThumbnails(); content.replaceChildren();
  if (!items.length) {
    const filtered = query || type !== 'all', empty = el('div', 'empty');
    empty.append(el('h2', '', t(filtered ? 'Aucun artefact ne correspond' : scope === 'session' ? 'Cette session n’a pas encore d’artefact' : 'Pas encore d’artefact ici')), el('p', '', t(filtered ? 'Essaie un autre type ou mot-clé.' : 'Élargis la portée pour retrouver un autre livrable.')));
    mountButton(empty, { label: t(filtered ? 'Effacer les filtres' : scope === 'session' ? result?.context.space.kind === 'chats' ? 'Voir Chats' : 'Voir le projet' : 'Voir tout'), size: 'sm', variant: 'outline', onClick: () => { if (filtered) { resetFilters(); changeView(); } else setScope(scope === 'session' ? 'space' : 'all'); } }); content.append(empty); return;
  }
  let day = '', grid: HTMLElement;
  for (const item of items) {
    const date = new Date(item.createdAt), label = dateLabel(date);
    if (label !== day) { day = label; const group = el('section', 'day-section'), head = el('header', 'day-heading'); head.append(el('h2', '', label), el('span', '', date.toLocaleDateString(locale))); grid = el('div', 'grid'); group.append(head, grid); content.append(group); }
    const card = el('article', 'artifact'), open = button('', () => void openDetail(item), 'artifact-open'), thumb = el('div', 'thumbnail');
    card.dataset.id = item.id;
    thumb.dataset.id = item.id; thumb.dataset.format = item.format; thumb.append(el('span', 'placeholder', item.format)); open.setAttribute('aria-label', t('Ouvrir {title}', { title: item.title })); open.append(thumb, el('span', 'artifact-title', item.title)); open.title = item.title;
    const meta = el('div', 'artifact-meta'), time = document.createElement('time'); time.dateTime = date.toISOString(); time.textContent = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }); time.title = date.toLocaleString(locale);
    const session = el('span', '', item.sessionArchived ? t('{title} · archivée', { title: item.sessionTitle }) : item.sessionTitle); session.title = item.sessionArchived ? t('{title} (conversation archivée)', { title: item.sessionTitle }) : item.sessionTitle; meta.append(time, session);
    const foot = el('div', 'artifact-foot'), source = button(spaceName(item), () => setProject(item.projectId), 'artifact-project');
    if (item.repo && item.repo !== source.textContent) { source.title = item.repo; }
    const add = button('+', () => void attach(item), 'quick-attach');
    add.setAttribute('aria-label', t('Ajouter {title} au message', { title: item.title })); add.title = t('Ajouter au brouillon actif'); add.disabled = !context.session;
    foot.append(source);
    if (!item.discovered) { const chat = button('💬', () => void host.openSession(item.sessionId).catch(report), 'quick-attach'); chat.setAttribute('aria-label', t(item.sessionArchived ? 'Ouvrir la conversation archivée' : 'Ouvrir la conversation')); chat.title = chat.getAttribute('aria-label')!; foot.append(chat); }
    foot.append(add); card.append(open, meta, foot); grid!.append(card);
    if (settings.previews === 'visible' && (item.kind === 'page' || item.kind === 'image')) observer.observe(thumb);
  }
  const pagination = el('div', 'pagination');
  for (const [label, delta] of [['Page précédente', -1], ['Page suivante', 1]] as const) {
    const node = button(t(label), () => { page += delta; pendingFocus = t(label); changeView(); window.scrollTo(0, 0); }, 'plain-button'); node.disabled = delta < 0 ? page <= 1 : page >= (result?.pages ?? 1); pagination.append(node);
    if (delta < 0) pagination.append(el('span', '', t('Page {page} / {pages} · {count} cartes', { page, pages: result?.pages ?? 1, count: items.length })));
  }
  content.append(pagination);
  if (pendingFocus) { const label = pendingFocus; pendingFocus = ''; [...pagination.querySelectorAll('button')].find(node => node.textContent === label)?.focus({ preventScroll: true }); }
}
async function bytes(resource: { key: string; mime: string; size: number }, current: () => boolean) {
  const chunks: Uint8Array[] = []; let offset = 0;
  do {
    if (!current()) throw Error('Aperçu fermé.');
    const result = await request(`/resource?key=${encodeURIComponent(resource.key)}&offset=${offset}`);
    const raw = atob(result.data); chunks.push(Uint8Array.from(raw, c => c.charCodeAt(0)));
    if (result.done) break;
    if (result.next <= offset) throw Error('Lecture du fichier interrompue.'); offset = result.next;
  } while (offset < resource.size);
  return new Blob(chunks, { type: resource.mime });
}
async function dataUrl(blob: Blob): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(Error('Image illisible.')); reader.readAsDataURL(blob); }); }
function iframe(root: HTMLElement, html: string, title: string, expanded: boolean, answer: unknown = null) {
  const frame = document.createElement('iframe'); frame.title = title; frame.setAttribute('sandbox', 'allow-scripts'); frame.referrerPolicy = 'no-referrer'; frame.srcdoc = previewDocument(html, context, answer);
  frame.className = expanded ? 'page-frame' : 'thumbnail-frame'; if (!expanded) { frame.tabIndex = -1; frame.setAttribute('aria-hidden', 'true'); }
  root.replaceChildren(frame); if (expanded) activePreview = frame; else { frame.style.transform = `scale(${root.clientWidth / 720})`; frameSizes.observe(root); }
}
async function display(root: HTMLElement, item: Item, expanded: boolean) {
  const version = expanded ? modalVersion : generation, epoch = root.dataset.epoch;
  const current = () => root.isConnected && version === (expanded ? modalVersion : generation) && (expanded || active.has(root) && root.dataset.epoch === epoch);
  const preview = await request('/preview?id=' + item.id); if (!current()) return;
  if (preview.kind === 'page') {
    let html = preview.html;
    for (const image of preview.images) { if (!current()) return; const source = await dataUrl(await bytes(image, current)); html = html.split(image.source).join(source); }
    if (!current()) return; iframe(root, html, item.title, expanded, preview.answer);
    if (expanded && preview.missing.length) root.append(el('p', 'source-note', t('{count} image(s) source indisponible(s).', { count: preview.missing.length })));
  } else if (item.kind === 'image') {
    const source = await dataUrl(await bytes(preview.resource, current)); if (!current()) return;
    const img = document.createElement('img'); img.alt = item.title; img.src = source; root.replaceChildren(img);
  } else if (['MD', 'TXT', 'CSV', 'TSV', 'HTML', 'HTM'].includes(item.format)) {
    const text = await (await bytes(preview.resource, current)).text(); if (!current()) return;
    if (['HTML', 'HTM'].includes(item.format)) iframe(root, text, item.title, expanded); else root.replaceChildren(el('pre', 'document-text', text));
  } else root.replaceChildren(el('p', 'source-note', t('Fichier {format} disponible. Ouvre sa session pour utiliser le lecteur natif.', { format: item.format })));
}
function dialogHeader(title: string) {
  modalVersion++; activePreview = null; dialog.replaceChildren(); dialog.className = 'preview-dialog';
  const head = el('header', 'dialog-header'), label = el('h2', '', title); label.id = 'preview-title'; head.append(label);
  mountButton(head, { label: t('Fermer'), size: 'sm', variant: 'ghost', onClick: closeDialog }); dialog.append(head);
}
function showDialog() { if (!dialog.open) dialog.showModal(); scheduleThumbnails(); }
async function openDetail(item: Item) {
  detail = item; dialogHeader(item.title);
  const body = el('div', 'dialog-body'), preview = el('div', 'expanded-preview'), details = el('aside', 'details'), list = el('dl');
  for (const [label, value] of [['Espace', spaceName(item)], ['Dépôt', item.repo ?? item.directory ?? t('Inconnu')], ['Session', item.sessionArchived ? t('{title} (archivée)', { title: item.sessionTitle }) : item.sessionTitle], ['Création', new Date(item.createdAt).toLocaleString(locale)], ['Type', item.format], ['Origine', t(item.origin)], ['Source', item.path ?? (item.discovered ? t('Fichier du projet') : `Message ${item.messageId}`)]]) list.append(el('dt', '', t(label)), el('dd', '', value));
  details.append(list); mountButton(details, { label: t('Ajouter au message'), size: 'sm', disabled: !context.session, onClick: () => void attach(item) });
  // Open the backing chat when one exists, archived or active; filesystem-only files have none.
  if (!item.discovered) mountButton(details, { label: t(item.sessionArchived ? 'Ouvrir la conversation archivée' : 'Ouvrir la conversation'), variant: 'outline', size: 'sm', onClick: async () => { try { await host.openSession(item.sessionId); closeDialog(); } catch (error) { report(error); } } });
  else details.append(el('p', 'source-note', t('Fichier trouvé dans le projet, sans conversation associée.')));
  details.append(el('p', 'source-note', context.session ? t('Destination : {title}. Seule la référence sera ajoutée.', { title: context.session.title }) : t('Ouvre une conversation pour y ajouter cette référence.')), el('p', 'source-note', t('Aperçu depuis la source. Les anciennes demandes de réponse restent désactivées.')));
  preview.append(el('p', 'source-note', t('Chargement…'))); body.append(preview, details); dialog.append(body); showDialog();
  try { await display(preview, item, true); } catch (error) { if (preview.isConnected) preview.replaceChildren(el('p', 'unavailable', t(error instanceof Error ? error.message : 'Source indisponible.'))); }
}
function spaceName(item: Item) { return item.spaceKind === 'unknown' ? t('Sources non classées') : item.projectName; }
function sourceUrl(item: Item) { const url = new URL('/', location.href); url.searchParams.set('session', item.sessionId); url.searchParams.set('message', item.messageId); return url.href; }
function referenceText(item: Item) { return t('Artefact : {title}\nEspace : {space}\nSession : {session} ({id})\nMessage : {message}\nSource : {source}\n{url}\nRéférence uniquement ; lire le fichier ou le message source si son contenu est demandé.', { title: item.title, space: spaceName(item), session: item.sessionTitle, id: item.sessionId, message: item.messageId, source: item.path ?? t(item.origin), url: sourceUrl(item) }); }
async function attach(item: Item) {
  if (!context.session) return;
  const target = context.session.id;
  const reference: AttachIssueRequest = { providerId: 'artifact-gallery', id: 'A-' + item.id.slice(0, 16), title: item.title, url: sourceUrl(item), text: referenceText(item), data: { artifactId: item.id, sessionId: item.sessionId, messageId: item.messageId } };
  try { await host.attach(reference); closeDialog(); if (context.session?.id === target && context.surface === 'page') await host.close(); }
  catch (error) { report(error); }
}
function openSettings() {
  detail = null; dialogHeader(t('Réglages de la galerie')); dialog.classList.add('settings-dialog'); const body = el('div', 'settings-body');
  body.append(el('p', 'source-note', t('Préférences de cette extension, conservées sur cette instance OpenChamber.')));
  for (const [key, label, options] of [
    ['language', 'Langue', [{ id: 'auto', label: 'Automatique (OpenChamber)' }, { id: 'en', label: 'English' }, { id: 'fr', label: 'Français' }]],
    ['previews', 'Aperçus', [{ id: 'visible', label: 'Quand la vignette est visible' }, { id: 'manual', label: 'À l’ouverture uniquement' }]],
    ['density', 'Densité', [{ id: 'comfortable', label: 'Confortable' }, { id: 'compact', label: 'Compacte' }]],
    ['pageSize', 'Cartes par page', [{ id: '12', label: '12 cartes' }, { id: '24', label: '24 cartes' }]],
  ] as const) {
    const row = el('div', 'setting-row'), slot = el('div'); row.append(el('span', '', t(label)), slot); body.append(row);
    const select = mountSelect(slot, { value: String(settings[key]), options: options.map(option => ({ ...option, label: t(option.label) })), onChange(value) { select.update({ value }); if (key === 'language') { settings.language = value === 'en' || value === 'fr' ? value : 'auto'; saveSettings(); updateLanguage(); return; } if (key === 'pageSize') settings.pageSize = value === '24' ? 24 : 12; else if (key === 'density') settings.density = value === 'compact' ? 'compact' : 'comfortable'; else settings.previews = value === 'manual' ? 'manual' : 'visible'; saveSettings(); page = 1; changeView(); } }); slot.querySelector('button')?.setAttribute('aria-label', t(label));
  }
  const row = el('label', 'setting-row'), check = document.createElement('input'); check.type = 'checkbox'; check.checked = settings.automatic; check.onchange = () => { settings.automatic = check.checked; saveSettings(); clearTimeout(timer); if (check.checked) void refresh(); };
  const iconRow = el('label', 'setting-row'), iconCheck = document.createElement('input'); iconCheck.type = 'checkbox'; iconCheck.checked = settings.projectIcons;
  iconCheck.onchange = () => { settings.projectIcons = iconCheck.checked; saveSettings(); renderChrome(); renderSpaces(projectMenu); };
  iconRow.append(el('span', '', t('Icônes des projets')), iconCheck); body.append(iconRow);
  row.append(el('span', '', t('Actualisation automatique')), check); body.append(row, el('p', 'source-note', t('2 lectures simultanées · 6 aperçus actifs maximum · pages de 12 ou 24 cartes. Les aperçus hors écran et ceux derrière une fenêtre sont déchargés. Ces limites ne plafonnent pas la RAM totale.')), el('p', 'source-note', t('L’apparence suit les couleurs, polices et arrondis transmis par OpenChamber. Le SDK 2.5.2 ne transmet pas l’échelle ni l’espacement de l’interface ; les polices externes peuvent utiliser une police de repli.')));
  dialog.append(body); showDialog();
}
function saveSettings() { const snapshot = { ...settings }; saveQueue = saveQueue.catch(() => {}).then(() => host.storage.set('preferences', snapshot)); void saveQueue.catch(error => report(error)); }
async function openPendingItem() {
  if (!mounted || !pendingItem) return;
  const id = pendingItem; pendingItem = null; const epoch = viewEpoch;
  try { const item = await request('/item?id=' + id); if (epoch === viewEpoch) await openDetail(item); }
  catch (error) { report(error); }
}
host.onItem(item => {
  const data = item && 'data' in item ? item.data : null;
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.artifactId !== 'string' || !/^[a-f0-9]{64}$/.test(data.artifactId)) return;
  pendingItem = data.artifactId; void openPendingItem();
});
window.addEventListener('message', event => { if (activePreview && event.source === activePreview.contentWindow && event.data?.type === 'openchamber:html-render:open-link' && typeof event.data.url === 'string' && /^https?:\/\//.test(event.data.url)) void host.openUrl(event.data.url).catch(report); });
host.onSession(session => { if (!context) return; const changed = context.session?.id !== session?.id; context = { ...context, session }; if (changed) followContext(); else renderChrome(); });
host.onDirectory(directory => { if (!context || context.directory === directory) return; context = { ...context, directory }; followContext(); });
host.onReady(ready => {
  const changed = context && (context.session?.id !== ready.session?.id || context.directory !== ready.directory), themeChanged = context?.theme.mode !== ready.theme.mode; context = ready; applyHostReady(ready, document.documentElement);
  // The SDK sets the root to .875rem, which shrinks every rem-based size a second time.
  document.documentElement.style.fontSize = '100%'; updateLanguage();
  if (mounted) { if (changed) followContext(); else if (themeChanged) { renderChrome(); renderSpaces(projectMenu); } for (const frame of app.querySelectorAll('iframe')) frame.contentWindow?.postMessage(previewThemeMessage(ready), '*'); return; }
  if (initialized) return; initialized = true;
  void (async () => {
    let storageError: unknown;
    try {
      const saved = await host.storage.get('preferences');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) settings = { previews: saved.previews === 'manual' ? 'manual' : 'visible', density: saved.density === 'compact' ? 'compact' : 'comfortable', pageSize: saved.pageSize === 24 ? 24 : 12, automatic: saved.automatic !== false, projectIcons: saved.projectIcons !== false, language: saved.language === 'en' || saved.language === 'fr' ? saved.language : 'auto' };
    } catch (error) { storageError = error; }
    updateLanguage(); scope = context.session ? 'session' : 'all'; mount();
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) { errorLine.textContent = t('Cette version de la galerie fonctionne sur l’instance locale OpenChamber.'); return; }
    try {
      await withCacheStorage(async (storage, owner, renew) => {
        const saved = await readCache(storage);
        if (saved) {
          const chunks = chunksFor(saved);
          for (let index = 0; index < chunks.length; index++) {
            await renew();
            await request('/cache', { owner, index, count: chunks.length, data: chunks[index] });
          }
        }
      });
      cacheRestored = true;
    }
    catch { cacheFailed(); }
    cacheReady = true;
    await refresh(true); void persistWhenSettled(); await openPendingItem(); if (storageError) report(Error('Préférences indisponibles ; réglages par défaut utilisés.'));
  })();
});
