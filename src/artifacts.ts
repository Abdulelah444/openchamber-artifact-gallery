import { basename, extname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export type Artifact = {
  id: string; sessionId: string; messageId: string; partId: string; position: number;
  title: string; kind: 'page' | 'image' | 'document' | 'table'; format: string;
  origin: string; createdAt: number; directory: string | null; path?: string; attachment?: boolean;
  /** Found by the filesystem crawl rather than referenced in a message. */
  discovered?: boolean;
};
const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const documentExtensions = new Set(['md', 'txt', 'pdf', 'html', 'htm', 'docx', 'xlsx', 'pptx', 'csv', 'tsv']);
export const localImagePattern = /(["'`])((?:file:\/\/|\/(?!\/)|[A-Za-z]:[\\/])[^"'`<>\n]*?\.(?:png|jpe?g|gif|webp))\1|url\(\s*((?:file:\/\/|\/(?!\/)|[A-Za-z]:[\\/])[^"'`<>()\s]*?\.(?:png|jpe?g|gif|webp))\s*\)/gi;
export const imageSources = (html: string): string[] => [...new Set([...html.matchAll(localImagePattern)].map(m => m[2] ?? m[3]))];
const object = (value: any) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const titleText = (text: string) => text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
const pageTitle = (html: string) => titleText(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(html)?.[1] ?? 'Page');

export function pathFromSource(source: string, directory: string | null): string | null {
  if (!source || source.includes('\0')) return null;
  try {
    if (source.startsWith('file:')) return fileURLToPath(source);
    if (/^[a-z][a-z\d+.-]*:/i.test(source) || source.startsWith('//')) return null;
    const path = decodeURIComponent(source.replace(/[?#].*$/, ''));
    return isAbsolute(path) ? resolve(path) : directory ? resolve(directory, path) : null;
  } catch { return null; }
}

export function pageContent(part: any) {
  if (part?.type !== 'tool' || part.name !== 'openchamber_render') return null;
  const state = object(part.state), input = object(state.input);
  const parameters = input.parameters && typeof input.parameters === 'object' ? input.parameters : input;
  if (typeof parameters.html !== 'string' || !parameters.html.trim()) return null;
  const meta = object(state.metadata?.openchamber);
  const interrupted = parameters.awaitAnswer === true && state.status === 'error';
  if (!(state.status === 'completed' && meta.ok === true) && !interrupted) return null;
  return {
    html: parameters.html,
    title: typeof parameters.title === 'string' && parameters.title.trim() ? titleText(parameters.title) : pageTitle(parameters.html),
    answer: meta.answer?.answered === true ? meta.answer.data ?? null : null,
  };
}

function toolResult(part: any) {
  for (const content of part.state?.content ?? []) {
    if (content.type !== 'text' || typeof content.text !== 'string') continue;
    try { const result = JSON.parse(content.text); if (result?.ok === true) return result.data; } catch { /* Other tool text is not a result envelope. */ }
  }
  return null;
}

/** Only visible, identifiable deliverables; source patches and incidental tool logs are not artifacts. */
export function extractArtifacts(message: any, sessionId: string, directory: string | null): Artifact[] {
  if (message?.type === 'user') {
    return (Array.isArray(message.files) ? message.files : []).flatMap((file: any, position: number) => {
      if (typeof file.data !== 'string' || !/^(image\/(png|jpeg|gif|webp|svg\+xml)|application\/pdf)$/.test(file.mime)) return [];
      const partId = `attachment-${position}`;
      return [{ id: createHash('sha256').update(JSON.stringify([sessionId, message.id, partId])).digest('hex'), sessionId, messageId: message.id, partId, position, directory, createdAt: message.time?.created ?? 0, title: titleText(file.name || 'Pièce jointe'), kind: file.mime.startsWith('image/') ? 'image' : 'document', format: file.mime.split('/')[1].toUpperCase(), origin: 'Pièce jointe', attachment: true } as Artifact];
    });
  }
  if (!['assistant', 'user'].includes(message?.type) || !Array.isArray(message.content)) return [];
  const result: Artifact[] = [], seen = new Set<string>();
  const add = (position: number, data: Pick<Artifact, 'kind' | 'format' | 'title' | 'origin'> & { path?: string }) => {
    const partId = typeof message.content[position]?.id === 'string' ? message.content[position].id : String(position);
    const key = data.path ?? partId;
    if (seen.has(key)) return;
    seen.add(key);
    const id = createHash('sha256').update(JSON.stringify([sessionId, message.id, partId, data.path ?? 'page'])).digest('hex');
    result.push({ id, sessionId, messageId: message.id, partId, position, directory, createdAt: message.time?.created ?? 0, ...data });
  };
  const file = (position: number, source: unknown, label: unknown, origin: string) => {
    if (typeof source !== 'string') return;
    const path = pathFromSource(source, directory);
    if (!path) return;
    const format = extname(path).slice(1).toLowerCase();
    if (!imageExtensions.has(format) && !documentExtensions.has(format)) return;
    add(position, { path, format: format.toUpperCase(), kind: imageExtensions.has(format) ? 'image' : ['csv', 'tsv', 'xlsx'].includes(format) ? 'table' : 'document', title: typeof label === 'string' && label.trim() ? titleText(label) : basename(path), origin });
  };
  message.content.forEach((part: any, position: number) => {
    const page = pageContent(part);
    if (page) add(position, { kind: 'page', format: 'HTML', title: page.title, origin: 'render.page' });
    if (part.type === 'file') file(position, part.url ?? part.source?.path, part.filename, 'Pièce jointe');
    if (part.type === 'text' && message.type === 'assistant' && typeof part.text === 'string') {
      // Code examples are not published deliverables.
      const text = part.text.replace(/```[\s\S]*?```/g, '');
      for (const match of text.matchAll(/!?\[([^\]\n]*)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"\n]*")?\)/g)) file(position, match[2] ?? match[3], match[1], 'Lien du message');
    }
    if (part.type !== 'tool' || part.state?.status !== 'completed' || part.state?.metadata?.openchamber?.ok !== true) return;
    const input = object(part.state.input), parameters = object(input.parameters ?? input);
    if (part.name === 'openchamber' && input.action === 'file.open') file(position, parameters.path, undefined, 'Fichier présenté');
    if (part.name === 'openchamber_web' && input.action === 'browser.capture') {
      const data = toolResult(part);
      file(position, data?.path ?? data?.screenshot?.path, parameters.label, 'Capture navigateur');
    }
  });
  return result;
}

/** Descending history crosses a move by restoring its previous directory. */
export function previousDirectory(message: any, current: string | null): string | null {
  return message.type === 'location-switched' ? message.previous?.location?.directory ?? null : current;
}
