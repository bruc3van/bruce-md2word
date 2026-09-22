import type MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import type { Diagnostics } from './diagnostics.js';
import { ExportError } from '../runtime/errors.js';

/** Small, explicit layout directives; never enable arbitrary HTML. */
export function installDocumentRules(md: MarkdownIt, diagnostics: Diagnostics): void {
  md.block.ruler.before('html_block', 'word_directive', (state, start, _end, silent) => {
    if (state.sCount[start] - state.blkIndent >= 4) return false;
    const text = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
    if (!/^<!-- word:/.test(text)) return false;
    if (silent) return true;
    const token = state.push('word_directive', '', 0);
    token.content = text;
    token.map = [start, start + 1];
    state.line = start + 1;
    return true;
  }, { alt: ['paragraph'] });
  md.renderer.rules.word_directive = (tokens, i) => `<div data-word-directive="${md.utils.escapeHtml(tokens[i].content)}" data-source-line="${tokens[i].map![0] + 1}"></div>\n`;

  // The plugin types reference markdown-it CJS; runtime API is identical in ESM.
  md.use(footnote as unknown as (parser: MarkdownIt) => void);
  // Named definitions only. Inline ^[...] remains literal Markdown.
  md.inline.ruler.disable('footnote_inline');
  const def = md.block.ruler.getRules('').find(rule => rule.name === 'footnote_def')!;
  const reference = md.block.ruler.getRules('').find(rule => rule.name === 'reference')!;
  const labels = new Set<string>();
  md.block.ruler.at('footnote_def', (state, start, end, silent) => {
    if (state.sCount[start] - state.blkIndent >= 4) return false;
    const text = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
    const label = /^\[\^([^\]\s]+)\]:/.exec(text)?.[1];
    if (!label) return false;
    if (labels.has(label) || String(state.parentType) === 'footnote') {
      if (!silent) {
        diagnostics.add(String(state.parentType) === 'footnote' ? 'FOOTNOTE_NESTED' : 'FOOTNOTE_DUPLICATE', 'Duplicate or nested footnote definition retained as text; existing definitions are unchanged.', 'degradation', start + 1);
        const token = state.push('footnote_duplicate', '', 0); token.content = text; token.map = [start, start + 1];
        state.line = start + 1;
      }
      return true;
    }
    if (!silent && labels.size >= 1000) throw new ExportError('Footnote count exceeds 1000.', 'LIMIT_EXCEEDED');
    const index = state.tokens.length;
    if (!silent) labels.add(label);
    const accepted = def(state, start, end, silent);
    if (accepted && !silent) state.tokens[index].map = [start, state.line];
    return accepted;
  }, { alt: ['paragraph', 'reference'] });
  md.block.ruler.at('reference', (state, start, end, silent) => {
    const text = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
    return /^\[\^/.test(text) ? false : reference(state, start, end, silent);
  });
  md.inline.ruler.before('footnote_ref', 'missing_footnote', (state, silent) => {
    const match = /^\[\^([^\]\s]+)\]/.exec(state.src.slice(state.pos));
    if (!match || labels.has(match[1])) return false;
    if (!silent) {
      const token = state.push('footnote_missing', '', 0);
      token.content = match[0];
      token.meta = { lineOffset: state.src.slice(0, state.pos).split('\n').length - 1 };
    }
    state.pos += match[0].length;
    return true;
  });
  md.core.ruler.before('footnote_tail', 'preserve_footnote_content', state => {
    let definition = false;
    let orphan = false;
    let line: number | undefined;
    for (const token of state.tokens) {
      if (token.type === 'footnote_reference_open') {
        definition = true;
        line = token.map ? token.map[0] + 1 : undefined;
        orphan = state.env.footnotes?.refs?.[`:${token.meta.label}`] === -1;
        if (orphan) {
          diagnostics.add('FOOTNOTE_UNUSED', 'Unreferenced footnote definition retained in the document body.', 'info', line);
          token.type = 'footnote_unused_open'; token.tag = 'div';
        }
      } else if (token.type === 'footnote_reference_close') {
        if (orphan) { token.type = 'footnote_unused_close'; token.tag = 'div'; }
        definition = false; orphan = false;
      }
      if (definition) for (const child of token.children ?? []) {
        if (child.type === 'footnote_ref') {
          child.type = 'text'; child.content = `[^${child.meta.label}]`;
          diagnostics.add('FOOTNOTE_NESTED', 'Nested footnote reference retained as text.', 'degradation', line);
        }
      }
    }
  });
  md.renderer.rules.footnote_missing = (tokens, i) => md.utils.escapeHtml(tokens[i].content);
  md.renderer.rules.footnote_duplicate = (tokens, i) => `<p>${md.utils.escapeHtml(tokens[i].content)}</p>\n`;
  md.renderer.rules.footnote_unused_open = (tokens, i) => `<div><p>${md.utils.escapeHtml(`[^${tokens[i].meta.label}]:`)}</p>`;
  md.renderer.rules.footnote_unused_close = () => '</div>\n';
  md.renderer.rules.footnote_ref = (tokens, i) => `<span data-footnote-ref="${tokens[i].meta.id + 1}"></span>`;
  md.renderer.rules.footnote_block_open = () => '<section data-footnotes="true">\n';
  md.renderer.rules.footnote_block_close = () => '</section>\n';
  md.renderer.rules.footnote_open = (tokens, i) => `<div data-footnote-id="${tokens[i].meta.id + 1}">`;
  md.renderer.rules.footnote_close = () => '</div>\n';
  md.renderer.rules.footnote_anchor = () => '';
}
