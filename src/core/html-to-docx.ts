// Adapted from bruce-doc-converter; per-conversion state replaces its globals.
import { JSDOM } from 'jsdom';
import { Paragraph, TextRun, ImageRun, ExternalHyperlink, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, HeadingLevel, VerticalAlign } from 'docx';
import type { ParagraphChild, IRunOptions, INumberingOptions } from 'docx';
import { CONTENT_WIDTH, numberingLevels } from './styles.js';
import type { Diagnostics } from './diagnostics.js';
export interface EmbeddedImage { data: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp'; width: number; height: number; displayWidth?: number }
type Block = Paragraph | Table;
export function convertHTMLToDocx(html: string, images: Map<string, EmbeddedImage>, diagnostics: Diagnostics): { children: Block[]; numbering: INumberingOptions } {
  const dom = new JSDOM(`<body>${html}</body>`);
  const numbering: INumberingOptions['config'][number][] = [];
  let nextList = 0;
  function textRuns(text: string, style: IRunOptions): TextRun[] {
    const pieces = text.split(/(\p{Emoji_Presentation}|\p{Extended_Pictographic}(?:\u{FE0F}|\u{200D}\p{Extended_Pictographic})*)/gu);
    return pieces.filter(Boolean).map(text => new TextRun({ ...(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/u.test(text) ? { font: 'Segoe UI Emoji' } : {}), ...style, text }));
  }
  function inline(nodes: Iterable<Node>, style: IRunOptions = {}, maxWidth = 560): ParagraphChild[] {
    const runs: ParagraphChild[] = [];
    for (const node of nodes) {
      if (node.nodeType === 3) {
        const raw = node.textContent ?? '';
        const collapsed = raw.replace(/\s+/g, ' ');
        const text = collapsed.trim() ? collapsed : /[ \t]/.test(raw) ? ' ' : '';
        if (text) runs.push(...textRuns(text, style));
        continue;
      }
      if (node.nodeType !== 1) continue;
      const el = node as Element;
      const tag = el.tagName;
      if (tag === 'IMG') {
        const image = images.get(el.getAttribute('src') ?? '');
        if (image) {
          const width = Math.min(image.displayWidth ?? 560, maxWidth);
          runs.push(new ImageRun({ type: image.type, data: image.data, transformation: { width, height: Math.round(width * image.height / image.width) }, altText: { title: el.getAttribute('alt') ?? '', description: el.getAttribute('alt') ?? '', name: 'Image' } }));
        } else runs.push(new TextRun({ ...style, text: `[图片: ${el.getAttribute('alt') || '图片'}]`, italics: true, color: '6B7280' }));
      } else if (tag === 'BR') runs.push(new TextRun({ text: '', break: 1 }));
      else if (tag === 'CODE') runs.push(...textRuns(el.textContent ?? '', { ...style, font: 'Consolas', size: 22, color: 'DC2626' }));
      else if (tag === 'A') {
        const href = el.getAttribute('href') ?? '';
        const children = inline(el.childNodes, { ...style, color: '2563EB', underline: {} }, maxWidth);
        if (href) runs.push(new ExternalHyperlink({ link: href, children }));
        else runs.push(...children);
      } else runs.push(...inline(el.childNodes, { ...style, ...(['STRONG', 'B'].includes(tag) ? { bold: true } : {}), ...(['EM', 'I'].includes(tag) ? { italics: true } : {}), ...(['DEL', 'S'].includes(tag) ? { strike: true } : {}) }, maxWidth));
    }
    return runs;
  }
  function list(el: Element, level: number): Block[] {
    const safeLevel = Math.min(level, 4);
    if (level > 4) diagnostics.add('LIST_DEPTH_REDUCED', 'List nesting deeper than five levels was flattened.');
    const ordered = el.tagName === 'OL';
    const reference = `list-${nextList++}`;
    const start = Number(el.getAttribute('start') ?? 1);
    numbering.push({ reference, levels: numberingLevels(ordered, Number.isSafeInteger(start) && start > 0 ? start : 1) });
    const result: Block[] = [];
    for (const li of Array.from(el.children).filter(child => child.tagName === 'LI')) {
      let numbered = false;
      let pending: Node[] = [];
      const flush = (force = false): void => {
        if (!pending.length && !force) return;
        result.push(new Paragraph({ children: inline(pending), ...(!numbered ? { numbering: { reference, level: safeLevel }, indent: { firstLine: 0 } } : { indent: { firstLine: 0, left: 720 * (safeLevel + 1) } }) }));
        numbered = true;
        pending = [];
      };
      for (const child of li.childNodes) {
        if (child.nodeType === 3 && !(child.textContent ?? '').trim()) continue;
        const tag = child.nodeName;
        if (tag === 'UL' || tag === 'OL') { flush(!numbered); result.push(...list(child as Element, level + 1)); }
        else if (tag === 'P') { flush(); pending.push(...child.childNodes); flush(!numbered); }
        else if (['PRE', 'TABLE', 'BLOCKQUOTE', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tag)) { flush(!numbered); result.push(...block(child, level)); }
        else pending.push(child);
      }
      flush(!numbered);
    }
    return result;
  }
  function block(node: Node, level = 0, quote = false, quoteAfter?: number): Block[] {
    if (node.nodeType === 3) return (node.textContent ?? '').trim() ? [new Paragraph({ children: inline([node]) })] : [];
    if (node.nodeType !== 1) return [];
    const el = node as Element;
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) return [new Paragraph({ children: inline(el.childNodes), heading: HeadingLevel[`HEADING_${tag[1]}` as keyof typeof HeadingLevel] })];
    if (tag === 'P' && el.hasAttribute('data-mermaid-notice')) return [new Paragraph({ children: [new TextRun({ text: el.textContent ?? '', color: '92400E', size: 20 })], indent: { firstLine: 0 }, spacing: { before: 160, after: 80 }, keepNext: true })];
    if (tag === 'P') return [new Paragraph({ children: inline(el.childNodes), ...(quote ? { style: 'Quote', ...(quoteAfter === undefined ? {} : { spacing: { after: quoteAfter } }) } : { indent: { firstLine: 480 } }) })];
    if (tag === 'PRE') {
      const lines = (el.textContent ?? '').split('\n');
      return [new Paragraph({ style: 'CodeBlock', children: lines.flatMap((text, index) => [...(index ? [new TextRun({ text: '', break: 1 })] : []), new TextRun({ text: text || ' ', font: 'Consolas', size: 22, color: '1F2937' })]) })];
    }
    if (tag === 'HR') return [new Paragraph({ indent: { firstLine: 0 }, spacing: { before: 200, after: 200 }, border: { bottom: { style: BorderStyle.SINGLE, color: '9CA3AF', size: 12, space: 1 } } })];
    if (tag === 'UL' || tag === 'OL') return list(el, level);
    if (tag === 'TABLE') {
      const trs = Array.from(el.querySelectorAll('tr'));
      const count = Math.max(1, ...trs.map(tr => tr.children.length));
      const widths = Array.from({ length: count }, (_, i) => Math.floor(CONTENT_WIDTH / count) + (i < CONTENT_WIDTH % count ? 1 : 0));
      const outer = { style: BorderStyle.SINGLE, size: 6, color: '9CA3AF' };
      const inner = { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' };
      return [new Table({ width: { size: CONTENT_WIDTH, type: WidthType.DXA }, columnWidths: widths, borders: { top: outer, bottom: outer, left: outer, right: outer, insideHorizontal: inner, insideVertical: inner }, rows: trs.map(tr => {
        const header = tr.parentElement?.tagName === 'THEAD';
        return new TableRow({ tableHeader: header || undefined, children: Array.from(tr.children).map((cell, i) => new TableCell({ width: { size: widths[i], type: WidthType.DXA }, ...(header ? { shading: { fill: 'E5E7EB' } } : {}), verticalAlign: VerticalAlign.CENTER, margins: { top: header ? 120 : 100, bottom: header ? 120 : 100, left: 150, right: 150 }, children: [new Paragraph({ indent: { firstLine: 0 }, alignment: header || cell.tagName === 'TH' ? AlignmentType.CENTER : AlignmentType.LEFT, children: inline(cell.childNodes, header ? { bold: true, size: 24 } : {}, Math.max(1, (widths[i] - 300) / 15)) })] })) });
      }) })];
    }
    if (tag === 'IMG') return [new Paragraph({ children: inline([el]), alignment: images.has(el.getAttribute('src') ?? '') ? AlignmentType.CENTER : undefined, indent: { firstLine: 0 }, spacing: { before: 200, after: 200 } })];
    if (tag === 'BLOCKQUOTE') {
      const children = Array.from(el.childNodes).filter(child => child.nodeType !== 3 || child.textContent?.trim());
      return children.flatMap((child, index) => block(child, level, true, index === children.length - 1 ? undefined : 0));
    }
    return Array.from(el.childNodes).flatMap(child => block(child, level, quote || tag === 'BLOCKQUOTE'));
  }
  try {
    const children = Array.from(dom.window.document.body.childNodes).flatMap(node => block(node));
    return { children: children.length ? children : [new Paragraph('')], numbering: { config: numbering } };
  } finally { dom.window.close(); }
}
