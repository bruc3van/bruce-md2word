// Adapted from bruce-doc-converter; see NOTICE and LICENSE.
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import type { Limits } from '../config.js';
import { Diagnostics } from './diagnostics.js';
import { ExportError } from '../runtime/errors.js';
export interface ImageReference { id: string; src: string; alt: string; line?: number }
export interface DiagramReference { id: string; source: string; line?: number }
export interface ParsedMarkdown { html: string; images: ImageReference[]; diagrams: DiagramReference[]; diagnostics: Diagnostics }
export function parseMarkdown(markdown: string, limits: Limits): ParsedMarkdown {
  const parser = new MarkdownIt({ html: false, linkify: false, typographer: false });
  // Recognize denied image references too so the caller receives a degradation diagnostic.
  const safeLink = parser.validateLink.bind(parser);
  parser.validateLink = value => /^(?:data:image\/|file:)/i.test(value) || safeLink(value);
  const diagnostics = new Diagnostics(limits.maxDiagnostics);
  const images: ImageReference[] = [];
  const diagrams: DiagramReference[] = [];
  const env = {};
  const tokens = parser.parse(markdown, env);
  parser.renderer.rules.fence = (items, index) => {
    const token = items[index];
    const language = token.info.trim().split(/\s+/)[0].replace(/[^a-zA-Z0-9_-]/g, '');
    return `<pre${token.meta?.diagramId ? ` data-mermaid="${token.meta.diagramId}"` : ''}><code${language ? ` class="language-${language}"` : ''}>${parser.utils.escapeHtml(token.content.replace(/\n$/, ''))}</code></pre>\n`;
  };
  const walk = (items: Token[], inheritedLine?: number): void => {
    for (const token of items) {
      const line = token.map ? token.map[0] + 1 : inheritedLine;
      if (token.type === 'fence' && token.info.trim().split(/\s+/)[0].toLowerCase() === 'mermaid') {
        if (images.length + diagrams.length >= limits.maxImages) throw new ExportError('Image and diagram count exceeds the configured limit.', 'LIMIT_EXCEEDED');
        const id = `mermaid-${diagrams.length}`;
        diagrams.push({ id, source: token.content, line });
        token.meta = { diagramId: id };
      }
      if (token.type === 'image') {
        if (images.length + diagrams.length >= limits.maxImages) throw new ExportError('Image count exceeds the configured limit.', 'LIMIT_EXCEEDED');
        const id = `image-${images.length}`;
        images.push({ id, src: token.attrGet('src') ?? '', alt: token.content, ...(line === undefined ? {} : { line }) });
        token.attrSet('src', id);
      } else if (token.type === 'link_open' && !safeLink(token.attrGet('href') ?? '')) {
        token.attrSet('href', '');
        diagnostics.add('LINK_UNAVAILABLE', 'Unsafe link target omitted.', 'degradation', line);
      }
      if (token.children) walk(token.children, line);
    }
  };
  walk(tokens);
  return { html: parser.renderer.render(tokens, parser.options, env).trimEnd(), images, diagrams, diagnostics };
}
