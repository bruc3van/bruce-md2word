// Adapted from bruce-doc-converter; see NOTICE and LICENSE.
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import type { Limits } from '../config.js';
import { Diagnostics } from './diagnostics.js';
import { ExportError } from '../runtime/errors.js';
import { installMathRules } from './math-markdown.js';
import { installDocumentRules } from './document-rules.js';
export interface ImageReference { id: string; src: string; alt: string; line?: number }
export interface DiagramReference { id: string; source: string; line?: number }
export interface FormulaReference { id: string; source: string; raw: string; display: boolean; unclosed: boolean; line?: number }
export interface ParsedMarkdown { html: string; images: ImageReference[]; diagrams: DiagramReference[]; formulas: FormulaReference[]; diagnostics: Diagnostics }
// Hangul is excluded: Korean separates words with spaces, so a line break stays a space.
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}　-〿＀-￯]/u;
const cjkPunctuation = /[　-〿！-／：-＠［-｀｛-･]/u;
const sourceLineBlocks = new Set(['paragraph_open', 'heading_open', 'bullet_list_open', 'ordered_list_open', 'list_item_open', 'blockquote_open', 'table_open', 'tr_open']);
const lastChar =(text: string): string => /[\uD800-\uDBFF][\uDC00-\uDFFF]$/.test(text) ? text.slice(-2) : text.slice(-1);
const firstChar = (text: string): string => String.fromCodePoint(text.codePointAt(0)!);
/** The adjacent character across emphasis/link boundaries, or undefined at any other inline token. */
function neighbor(tokens: Token[], index: number, step: 1 | -1): string | undefined {
  for (let i = index + step; i >= 0 && i < tokens.length; i += step) {
    const token = tokens[i];
    if (/_(?:open|close)$/.test(token.type)) continue;
    if (token.type !== 'text' && token.type !== 'code_inline') return undefined;
    if (!token.content) continue;
    return step < 0 ? lastChar(token.content) : firstChar(token.content);
  }
  return undefined;
}
/** A source line break between CJK characters is not a word space (CSS Text segment-break rules). */
function joinCjkLines(tokens: Token[]): void {
  for (const token of tokens) {
    if (token.type !== 'inline' || !token.children) continue;
    token.children.forEach((child, i, children) => {
      if (child.type !== 'softbreak') return;
      const before = neighbor(children, i, -1), after = neighbor(children, i, 1);
      if (before && after && (cjk.test(before) && cjk.test(after) || cjkPunctuation.test(before) || cjkPunctuation.test(after))) {
        child.type = 'text'; child.content = '';
      }
    });
  }
}
const lineBreakTag = /<br\s*\/?>/i;
// Known tag names only, so prose such as List<String> is not reported.
const htmlTag = /<\/?(?:a|abbr|b|big|center|code|del|details|div|em|font|h[1-6]|hr|i|img|ins|kbd|li|mark|ol|p|pre|s|small|span|strong|sub|summary|sup|table|td|th|tr|u|ul)(?:\s[^<>]*)?\/?>/i;
/** Raw HTML stays text, except <br> (common in generated table cells) and task markers. */
function adaptPlainHtml(tokens: Token[], diagnostics: Diagnostics, TokenClass: typeof Token): void {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'inline' || !token.children) continue;
    const line = token.map ? token.map[0] + 1 : undefined;
    // Before text_join, an escaped \< is still a separate text_special token.
    token.children = token.children.flatMap(child => {
      if (child.type !== 'text' || !lineBreakTag.test(child.content)) return [child];
      return child.content.split(lineBreakTag).flatMap((content, index) => {
        const text = Object.assign(new TokenClass('text', '', 0), { content });
        return index ? [new TokenClass('hardbreak', 'br', 0), text] : [text];
      });
    });
    if (token.children.some(child => child.type === 'text' && htmlTag.test(child.content))) {
      diagnostics.add('HTML_AS_TEXT', 'Raw HTML is not interpreted and is shown as literal text; use Markdown syntax instead.', 'info', line);
    }
    const first = token.children[0];
    if (tokens[i - 1]?.type === 'paragraph_open' && tokens[i - 2]?.type === 'list_item_open' && first?.type === 'text') {
      // The marker may end the token: an empty item, or text starting on the next line after a soft break.
      first.content = first.content.replace(/^\[([ xX])\](\s+|$)/, (_, mark: string, space: string) => (mark === ' ' ? '☐' : '☑') + (space ? ' ' : ''));
    }
  }
}
export function parseMarkdown(markdown: string, limits: Limits): ParsedMarkdown {
  const parser = new MarkdownIt({ html: false, linkify: false, typographer: false });
  installMathRules(parser);
  // Recognize denied image references too so the caller receives a degradation diagnostic.
  const safeLink = parser.validateLink.bind(parser);
  parser.validateLink = value => /^(?:data:image\/|file:)/i.test(value) || safeLink(value);
  const diagnostics = new Diagnostics(limits.maxDiagnostics);
  installDocumentRules(parser, diagnostics);
  parser.core.ruler.before('text_join', 'plain_html', state => adaptPlainHtml(state.tokens, diagnostics, state.Token));
  // Runs after footnote_tail so footnote bodies are joined too.
  parser.core.ruler.push('cjk_line_join', state => joinCjkLines(state.tokens));
  const images: ImageReference[] = [];
  const diagrams: DiagramReference[] = [];
  const formulas: FormulaReference[] = [];
  const env = {};
  const tokens = parser.parse(markdown, env);
  parser.renderer.rules.fence = (items, index) => {
    const token = items[index];
    const language = token.info.trim().split(/\s+/)[0].replace(/[^a-zA-Z0-9_-]/g, '');
    return `<pre${token.meta?.diagramId ? ` data-mermaid="${token.meta.diagramId}"` : ''}><code${language ? ` class="language-${language}"` : ''}>${parser.utils.escapeHtml(token.content.replace(/\n$/, ''))}</code></pre>\n`;
  };
  const walk = (items: Token[], inheritedLine?: number): void => {
    let currentLine = inheritedLine;
    for (const token of items) {
      if (token.map) currentLine = token.map[0] + 1;
      const line = currentLine === undefined ? undefined : currentLine + (token.meta?.lineOffset ?? 0);
      if (token.type === 'footnote_missing') diagnostics.add('FOOTNOTE_UNDEFINED', 'Undefined footnote reference retained as text.', 'degradation', line);
      if (token.type === 'math_inline' || token.type === 'math_block') {
        if (formulas.length >= 1000) throw new ExportError('Formula count exceeds 1000.', 'LIMIT_EXCEEDED');
        const id = `math-${formulas.length}`;
        formulas.push({ id, source: token.content, raw: token.meta.raw, display: token.type === 'math_block', unclosed: token.meta.unclosed, line });
        token.meta.mathId = id;
      }
      if (token.type === 'fence' && token.info.trim().split(/\s+/)[0].toLowerCase() === 'mermaid') {
        if (images.length + diagrams.length >= limits.maxImages) throw new ExportError('Image and diagram count exceeds the configured limit.', 'LIMIT_EXCEEDED');
        const id = `mermaid-${diagrams.length}`;
        diagrams.push({ id, source: token.content, line });
        token.meta = { diagramId: id };
      }
      if (token.type === 'image') {
        // Image alt text is descriptive text, not a Word equation container.
        // markdown-it's renderInlineAsText otherwise drops custom math tokens.
        for (const child of token.children ?? []) {
          if (child.type === 'math_inline') { child.type = 'text'; child.content = child.meta.raw; }
          if (child.type === 'footnote_missing') {
            diagnostics.add('FOOTNOTE_UNDEFINED', 'Undefined footnote reference retained in image alternative text.', 'degradation', line);
            child.type = 'text';
          }
          if (child.type === 'footnote_ref') { child.type = 'text'; child.content = `[^${child.meta.label}]`; }
        }
        if (images.length + diagrams.length >= limits.maxImages) throw new ExportError('Image count exceeds the configured limit.', 'LIMIT_EXCEEDED');
        const id = `image-${images.length}`;
        images.push({ id, src: token.attrGet('src') ?? '', alt: token.content, ...(line === undefined ? {} : { line }) });
        token.attrSet('src', id);
      } else if (token.type === 'link_open' && !safeLink(token.attrGet('href') ?? '')) {
        token.attrSet('href', '');
        diagnostics.add('LINK_UNAVAILABLE', 'Unsafe link target omitted.', 'degradation', line);
      }
      if (token.children && token.type !== 'image') walk(token.children, line);
    }
  };
  walk(tokens);
  // Layout diagnostics are raised from the HTML; carry block source lines there.
  for (const token of tokens) {
    if (token.nesting === 1 && token.map && sourceLineBlocks.has(token.type)) token.attrSet('data-source-line', String(token.map[0] + 1));
  }
  return { html: parser.renderer.render(tokens, parser.options, env).trimEnd(), images, diagrams, formulas, diagnostics };
}
