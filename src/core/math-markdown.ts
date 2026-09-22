import type MarkdownIt from 'markdown-it';

/** Math is tokenized before Markdown escapes/emphasis, never inside code tokens. */
export function installMathRules(parser: MarkdownIt): void {
  const escaped = (source: string, pos: number): boolean => {
    let slashes = 0;
    while (pos > 0 && source[--pos] === '\\') slashes++;
    return slashes % 2 === 1;
  };
  parser.inline.ruler.before('escape', 'math_inline', (state, silent) => {
    const start = state.pos;
    const source = state.src;
    const opener = source.startsWith('\\(', start) ? '\\(' : source[start] === '$' && source[start + 1] !== '$' && source[start - 1] !== '$' ? '$' : '';
    if (!opener) return false;
    const dollar = opener === '$';
    if (dollar && (/\s/.test(source[start + 1] ?? ' ') || /[\d]/.test(source[start - 1] ?? ''))) return false;
    const closer = dollar ? '$' : '\\)';
    let end = start + opener.length;
    for (; end < state.posMax; end++) {
      if (source[end] === '\n' || (dollar && source[end] === '`')) break;
      if (source.startsWith(closer, end) && !escaped(source, end)) break;
    }
    const closed = end < state.posMax && source.startsWith(closer, end)
      && (!dollar || (!/\s/.test(source[end - 1]) && !/[\d$]/.test(source[end + 1] ?? '') && source[end - 1] !== '$'));
    // An unmatched dollar is ordinary currency/prose. Explicit \( is unambiguous.
    if (!closed && dollar) return false;
    const content = source.slice(start + opener.length, end);
    // Avoid treating "$5 and $10" or "$5 to 10$" as mathematical markup.
    if (dollar && /^\d[\d.,]*\s+(?:and|to|至|和)\s*\d[\d.,]*$/.test(content)) return false;
    if (!silent) {
      const token = state.push('math_inline', 'span', 0);
      token.content = content;
      token.meta = { raw: source.slice(start, end + (closed ? closer.length : 0)), unclosed: !closed, lineOffset: source.slice(0, start).split('\n').length - 1 };
    }
    state.pos = end + (closed ? closer.length : 0);
    return true;
  });
  parser.block.ruler.before('fence', 'math_block', (state, start, end, silent) => {
    if (state.sCount[start] - state.blkIndent >= 4) return false;
    const first = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
    const opener = first.startsWith('$$') ? '$$' : first.startsWith('\\[') ? '\\[' : '';
    if (!opener) return false;
    if (silent) return true;
    const closer = opener === '$$' ? '$$' : '\\]';
    const lines: string[] = [];
    let closed = false;
    let next = start;
    for (; next < end; next++) {
      if (next > start && state.sCount[next] < state.blkIndent && !state.isEmpty(next)) break;
      const line = state.src.slice(state.bMarks[next] + state.tShift[next], state.eMarks[next]);
      const body = next === start ? line.slice(opener.length) : line;
      let at = body.indexOf(closer);
      while (at >= 0 && (escaped(body, at) || body.slice(at + closer.length).trim())) at = body.indexOf(closer, at + closer.length);
      if (at >= 0) { lines.push(body.slice(0, at)); closed = true; next++; break; }
      lines.push(body);
    }
    const token = state.push('math_block', 'p', 0);
    token.block = true;
    token.map = [start, next];
    token.content = lines.join('\n');
    token.meta = { raw: opener + token.content + (closed ? closer : ''), unclosed: !closed };
    state.line = next;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  const render = (tokens: Parameters<NonNullable<typeof parser.renderer.rules.text>>[0], index: number): string => {
    const token = tokens[index];
    const id = token.meta.mathId;
    return token.type === 'math_block' ? `<p data-math-block="${id}"><span data-math="${id}"></span></p>\n` : `<span data-math="${id}"></span>`;
  };
  parser.renderer.rules.math_inline = render;
  parser.renderer.rules.math_block = render;
}
