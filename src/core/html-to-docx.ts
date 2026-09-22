// Adapted from bruce-doc-converter; per-conversion state replaces its globals.
import { JSDOM } from 'jsdom';
import { Paragraph, TextRun, ImageRun, ExternalHyperlink, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, HeadingLevel, VerticalAlign, Bookmark, InternalHyperlink } from 'docx';
import type { ParagraphChild, IRunOptions, INumberingOptions } from 'docx';
import { CONTENT_WIDTH, MAX_IMAGE_HEIGHT, numberingLevels, charsToTwips } from './styles.js';
import type { Diagnostics } from './diagnostics.js';
export interface EmbeddedImage { data: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp'; width: number; height: number; displayWidth?: number }
type Block = Paragraph | Table;
// All horizontal layout is computed in twips; ImageRun uses 96-DPI pixels.
interface Layout { left: number; right: number; quote: boolean }
const rootLayout: Layout = { left: 0, right: 0, quote: false };
const availablePixels = (layout: Layout): number => Math.max(1, (CONTENT_WIDTH - layout.left - layout.right) / 15);
const headingSlug = (text: string): string => text.toLowerCase().trim().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-');
export function convertHTMLToDocx(html: string, images: Map<string, EmbeddedImage>, diagnostics: Diagnostics, formulas = new Map<string, ParagraphChild[]>()): { children: Block[]; numbering: INumberingOptions } {
  const dom = new JSDOM(`<body>${html}</body>`);
  const numbering: INumberingOptions['config'][number][] = [];
  let nextList = 0;
  const anchors = new Map<string, string>();
  const bookmarks = new Map<Element, string>();
  for (const heading of Array.from(dom.window.document.querySelectorAll('h1,h2,h3,h4,h5,h6'))) {
    const base = headingSlug(heading.textContent ?? '') || 'section';
    let slug = base, suffix = 0;
    while (anchors.has(slug)) slug = `${base}-${++suffix}`;
    const name = `heading_${bookmarks.size + 1}`;
    anchors.set(slug, name);
    bookmarks.set(heading, name);
  }
  function textRuns(text: string, style: IRunOptions): TextRun[] {
    const pieces = text.split(/(\p{Emoji_Presentation}|\p{Extended_Pictographic}(?:\u{FE0F}|\u{200D}\p{Extended_Pictographic})*)/gu);
    return pieces.filter(Boolean).map(text => new TextRun({ ...(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/u.test(text) ? { font: 'Segoe UI Emoji' } : {}), ...style, text }));
  }
  function inline(nodes: Iterable<Node>, style: IRunOptions = {}, maxWidth = CONTENT_WIDTH / 15): ParagraphChild[] {
    const runs: ParagraphChild[] = [];
    for (const node of nodes) {
      if (node.nodeType === 3) {
        // markdown-it adds a formatting newline after <br>; the run already
        // contains the hard break, so do not turn that newline into a space.
        const raw = node.previousSibling?.nodeName === 'BR'
          ? (node.textContent ?? '').replace(/^\r?\n/, '') : node.textContent ?? '';
        const collapsed = raw.replace(/[ \t\r\n\f]+/g, ' ');
        const text = collapsed;
        if (text) runs.push(...textRuns(text, style));
        continue;
      }
      if (node.nodeType !== 1) continue;
      const el = node as Element;
      const tag = el.tagName;
      if (el.hasAttribute('data-math')) {
        const formula = formulas.get(el.getAttribute('data-math')!);
        if (!formula) throw new Error('Missing converted formula');
        runs.push(...formula);
        continue;
      }
      if (tag === 'IMG') {
        const image = images.get(el.getAttribute('src') ?? '');
        if (image) {
          const width = Math.min(image.displayWidth ?? image.width, 560, maxWidth, MAX_IMAGE_HEIGHT * image.width / image.height);
          runs.push(new ImageRun({ type: image.type, data: image.data, transformation: { width, height: Math.round(width * image.height / image.width) }, altText: { title: el.getAttribute('alt') ?? '', description: el.getAttribute('alt') ?? '', name: 'Image' } }));
        } else runs.push(new TextRun({ ...style, text: `[图片: ${el.getAttribute('alt') || '图片'}]`, italics: true, color: '6B7280' }));
      } else if (tag === 'BR') runs.push(new TextRun({ text: '', break: 1 }));
      else if (tag === 'CODE') runs.push(...textRuns(el.textContent ?? '', { ...style, font: 'Consolas', size: 22, color: 'DC2626' }));
      else if (tag === 'A') {
        const href = el.getAttribute('href') ?? '';
        const children = inline(el.childNodes, { ...style, color: '2563EB', underline: {} }, maxWidth);
        if (href.startsWith('#')) {
          let target: string | undefined;
          try { target = anchors.get(decodeURIComponent(href.slice(1))); } catch { /* Invalid fragment. */ }
          if (target) runs.push(new InternalHyperlink({ anchor: target, children }));
          else {
            runs.push(...children);
            diagnostics.add('LINK_UNAVAILABLE', 'Internal link has no matching heading; link text retained.');
          }
        } else if (href) runs.push(new ExternalHyperlink({ link: href, children }));
        else runs.push(...children);
      } else runs.push(...inline(el.childNodes, { ...style, ...(['STRONG', 'B'].includes(tag) ? { bold: true } : {}), ...(['EM', 'I'].includes(tag) ? { italics: true } : {}), ...(['DEL', 'S'].includes(tag) ? { strike: true } : {}) }, maxWidth));
    }
    return runs;
  }
  function list(el: Element, level: number, layout: Layout): Block[] {
    const safeLevel = Math.min(level, 4);
    if (level > 4) diagnostics.add('LIST_DEPTH_REDUCED', 'List nesting deeper than five levels was flattened.');
    const ordered = el.tagName === 'OL';
    const reference = `list-${nextList++}`;
    const textLeft = Math.min(layout.left + (level > 4 ? 0 : 720), CONTENT_WIDTH - layout.right - 720);
    const hanging = ordered ? 480 : 360;
    const itemLayout = { ...layout, left: textLeft };
    const start = Number(el.getAttribute('start') ?? 1);
    numbering.push({ reference, levels: numberingLevels(ordered, Number.isSafeInteger(start) && start >= 0 ? start : 1).map(item => ({
      ...item, style: { ...item.style, paragraph: { ...item.style?.paragraph,
        indent: { left: textLeft, hanging }, tabStops: [{ type: 'left', position: textLeft }],
      } },
    })) });
    const result: Block[] = [];
    for (const li of Array.from(el.children).filter(child => child.tagName === 'LI')) {
      let numbered = false;
      let pending: Node[] = [];
      const flush = (force = false): void => {
        if (!pending.length && !force) return;
        result.push(new Paragraph({ children: inline(pending, {}, availablePixels(itemLayout)),
          ...(layout.quote ? { style: 'Quote' } : {}),
          ...(!numbered ? { numbering: { reference, level: safeLevel }, indent: { left: textLeft, hanging, right: layout.right } }
            : { indent: { firstLine: 0, hanging: 0, left: textLeft, right: layout.right } }),
        }));
        numbered = true;
        pending = [];
      };
      for (const child of li.childNodes) {
        // Keep soft breaks between inline siblings, but discard list HTML layout whitespace.
        if (child.nodeType === 3 && !(child.textContent ?? '').trim()
          && (!pending.length || !child.nextSibling || /^(UL|OL|P|PRE|TABLE|BLOCKQUOTE|HR|H[1-6])$/.test(child.nextSibling.nodeName))) continue;
        const tag = child.nodeName;
        if (tag === 'UL' || tag === 'OL') { flush(!numbered); result.push(...list(child as Element, level + 1, itemLayout)); }
        else if (tag === 'P' && (child as Element).hasAttribute('data-math-block')) { flush(!numbered); result.push(...block(child, level, itemLayout)); }
        else if (tag === 'P') { flush(); pending.push(...child.childNodes); flush(!numbered); }
        else if (['PRE', 'TABLE', 'BLOCKQUOTE', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tag)) { flush(!numbered); result.push(...block(child, level, itemLayout)); }
        else pending.push(child);
      }
      flush(!numbered);
    }
    return result;
  }
  function block(node: Node, level = 0, layout: Layout = rootLayout, quoteAfter?: number): Block[] {
    if (node.nodeType === 3) return (node.textContent ?? '').trim() ? [new Paragraph({ children: inline([node], {}, availablePixels(layout)), indent: { left: layout.left, right: layout.right } })] : [];
    if (node.nodeType !== 1) return [];
    const el = node as Element;
    const tag = el.tagName;
    const width = availablePixels(layout);
    const indent = { left: layout.left, right: layout.right, firstLine: 0 };
    if (/^H[1-6]$/.test(tag)) return [new Paragraph({ children: [new Bookmark({ id: bookmarks.get(el)!, children: inline(el.childNodes, {}, width) })], indent, heading: HeadingLevel[`HEADING_${tag[1]}` as keyof typeof HeadingLevel] })];
    if (tag === 'P' && el.hasAttribute('data-math-block')) return [new Paragraph({ children: inline(el.childNodes, {}, width), alignment: AlignmentType.CENTER, indent, spacing: { before: 160, after: 160 } })];
    if (tag === 'P' && el.hasAttribute('data-mermaid-notice')) return [new Paragraph({ children: [new TextRun({ text: el.textContent ?? '', color: '92400E', size: 20 })], indent, spacing: { before: 160, after: 80 }, keepNext: true })];
    if (tag === 'P') {
      const meaningful = Array.from(el.childNodes).filter(child => child.nodeType !== 3 || child.textContent?.trim());
      if (meaningful.length === 1 && meaningful[0].nodeName === 'IMG') return block(meaningful[0], level, layout);
      return [new Paragraph({ children: inline(el.childNodes, {}, width), style: layout.quote ? 'Quote' : 'BodyText',
        ...(layout.quote || layout.left || layout.right ? { indent } : {}),
        ...(layout.quote && quoteAfter !== undefined ? { spacing: { after: quoteAfter } } : {}),
      })];
    }
    if (tag === 'PRE') {
      const lines = (el.textContent ?? '').split('\n');
      return [new Paragraph({ style: 'CodeBlock', indent: { ...indent, left: layout.left + 240, right: layout.right + 240 }, children: lines.flatMap((text, index) => [...(index ? [new TextRun({ text: '', break: 1 })] : []), new TextRun({ text: text || ' ', font: 'Consolas', size: 22, color: '1F2937' })]) })];
    }
    if (tag === 'HR') return [new Paragraph({ indent, spacing: { before: 200, after: 200 }, border: { bottom: { style: BorderStyle.SINGLE, color: '9CA3AF', size: 12, space: 1 } } })];
    if (tag === 'UL' || tag === 'OL') return list(el, level, layout);
    if (tag === 'TABLE') {
      const trs = Array.from(el.querySelectorAll('tr'));
      const count = Math.max(1, ...trs.map(tr => tr.children.length));
      const tableWidth = Math.max(1, CONTENT_WIDTH - layout.left - layout.right);
      const widths = Array.from({ length: count }, (_, i) => Math.floor(tableWidth / count) + (i < tableWidth % count ? 1 : 0));
      const outer = { style: BorderStyle.SINGLE, size: 6, color: '9CA3AF' };
      const inner = { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' };
      return [new Table({ indent: { size: layout.left, type: WidthType.DXA }, width: { size: tableWidth, type: WidthType.DXA }, columnWidths: widths, borders: { top: outer, bottom: outer, left: outer, right: outer, insideHorizontal: inner, insideVertical: inner }, rows: trs.map(tr => {
        const header = tr.parentElement?.tagName === 'THEAD';
        return new TableRow({ tableHeader: header || undefined, children: Array.from(tr.children).map((cell, i) => new TableCell({ width: { size: widths[i], type: WidthType.DXA }, ...(header ? { shading: { fill: 'E5E7EB' } } : {}), verticalAlign: VerticalAlign.CENTER, margins: { top: header ? 120 : 100, bottom: header ? 120 : 100, left: 150, right: 150 }, children: [new Paragraph({ indent: { firstLine: 0 }, alignment: ({ left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT } as Record<string, typeof AlignmentType.LEFT | typeof AlignmentType.CENTER | typeof AlignmentType.RIGHT>)[(cell as HTMLElement).style.textAlign] ?? (header || cell.tagName === 'TH' ? AlignmentType.CENTER : AlignmentType.LEFT), children: inline(cell.childNodes, header ? { bold: true, size: 24 } : {}, Math.max(1, (widths[i] - 300) / 15)) })] })) });
      }) })];
    }
    if (tag === 'IMG') return [new Paragraph({ children: inline([el], {}, width), alignment: images.has(el.getAttribute('src') ?? '') ? AlignmentType.CENTER : undefined, indent, spacing: { before: 200, after: 200 } })];
    if (tag === 'BLOCKQUOTE') {
      const children = Array.from(el.childNodes).filter(child => child.nodeType !== 3 || child.textContent?.trim());
      return children.flatMap((child, index) => block(child, level, { ...layout, left: layout.left + charsToTwips(2), quote: true }, index === children.length - 1 ? undefined : 0));
    }
    return Array.from(el.childNodes).flatMap(child => block(child, level, layout));
  }
  try {
    const children = Array.from(dom.window.document.body.childNodes).flatMap(node => block(node));
    return { children: children.length ? children : [new Paragraph('')], numbering: { config: numbering } };
  } finally { dom.window.close(); }
}
