import { Document, Packer, TextRun, Paragraph, Header, Footer, PageNumber, TableOfContents, AlignmentType, SectionType, PageOrientation, XmlComponent } from 'docx';
import type { ParagraphChild, ISectionOptions, FileChild, IContext, IXmlableObject } from 'docx';
import { latexToWordMath } from './math.js';
import { prepareDiagramImage, finishDiagram } from './mermaid.js';
import type { PreparedDiagram } from './mermaid.js';
import sharp from 'sharp';
import bmp from 'bmp-js';
import type { Limits } from '../config.js';
import { ExportError } from '../runtime/errors.js';
import type { ParsedMarkdown } from './markdown.js';
import { convertHTMLToDocx, createImageRun } from './html-to-docx.js';
import type { EmbeddedImage, ImageBounds, LazyImages } from './html-to-docx.js';
import { createStyles, PAGE_WIDTH, PAGE_HEIGHT } from './styles.js';
import { mmToTwips } from './document-options.js';
import type { Diagnostic } from './diagnostics.js';
export interface AcquiredImage { id: string; data: Uint8Array }
/** A run placed during layout and resolved before packing; docx reads image media only at serialization. */
class DeferredRun extends XmlComponent {
  target?: XmlComponent;
  constructor() { super('w:r'); }
  override prepForXml(context: IContext): IXmlableObject | undefined {
    if (!this.target) throw new Error('Unresolved deferred image');
    return this.target.prepForXml(context);
  }
}
export async function convert(parsed: ParsedMarkdown, assets: AcquiredImage[], warnings: Diagnostic[], limits: Limits): Promise<{ data: Uint8Array; warnings: Diagnostic[] }> {
  for (const warning of warnings) parsed.diagnostics.add(warning.code, warning.message, warning.severity, warning.line);
  const images = new Map<string, EmbeddedImage>();
  // Repeated references share one acquired buffer: decode and budget it once.
  const decoded = new Map<Uint8Array, { image: EmbeddedImage; animated: boolean } | null>();
  let normalizedBytes = 0;
  for (const asset of assets) {
    const ref = parsed.images.find(image => image.id === asset.id);
    if (!ref) throw new ExportError('Unknown image in worker response.', 'CONVERSION_FAILED');
    let result = decoded.get(asset.data);
    if (result === undefined) {
      try { result = await normalizeImage(asset.data, limits); }
      catch (error) { if (error instanceof ExportError) throw error; result = null; }
      decoded.set(asset.data, result);
      if (result) {
        normalizedBytes += result.image.data.byteLength;
        if (normalizedBytes > limits.maxTotalImageBytes) throw new ExportError('Normalized images exceed the aggregate byte limit.', 'LIMIT_EXCEEDED');
      }
    }
    if (!result) { parsed.diagnostics.add('IMAGE_UNAVAILABLE', 'Unsupported or damaged image; alternative text retained.', 'degradation', ref.line); continue; }
    if (result.animated) parsed.diagnostics.add('IMAGE_FIRST_FRAME', 'Only the first frame of an animated image is included.', 'degradation', ref.line);
    images.set(asset.id, result.image);
  }
  // Parsing and drawing do not depend on placement, so unsupported diagrams are
  // known before layout and keep their source. Placement bounds come from the
  // single layout traversal below; rasterization then fills deferred runs.
  const diagrams = new Map(parsed.diagrams.map(diagram => [diagram.id, diagram]));
  const prepared = new Map<string, PreparedDiagram>();
  for (const diagram of parsed.diagrams) {
    try { prepared.set(diagram.id, await prepareDiagramImage(diagram.source, limits)); }
    catch (error) {
      if (error instanceof ExportError) throw error;
      parsed.diagnostics.add('MERMAID_NOT_RENDERED', 'Mermaid syntax or rendering is unsupported; source retained as code.', 'degradation', diagram.line);
    }
  }
  const html = parsed.diagrams.length ? parsed.html.replace(/<pre data-mermaid="([^"]+)">([\s\S]*?)<\/pre>/g, (_, id: string, code: string) => {
    if (prepared.has(id)) return `<img src="${id}" alt="Mermaid 图表"/>`;
    const line = diagrams.get(id)?.line;
    return `<p data-mermaid-notice="true">Mermaid 图表未渲染${line ? `（源文件第 ${line} 行）` : ''}：当前渲染器不支持该语法或渲染失败，以下保留原始代码。</p><pre>${code}</pre>`;
  }) : parsed.html;
  const placements: { id: string; bounds: ImageBounds; alt: string; run: DeferredRun }[] = [];
  const lazyImages: LazyImages = new Map([...prepared.keys()].map(id => [id, (bounds: ImageBounds, alt: string) => {
    const run = new DeferredRun();
    placements.push({ id, bounds, alt, run });
    return run as unknown as ParagraphChild;
  }]));
  const formulas = new Map<string, ParagraphChild[]>();
  for (const formula of parsed.formulas) {
    try {
      if (formula.unclosed) throw new Error('Unclosed formula delimiter');
      formulas.set(formula.id, [latexToWordMath(formula.source, formula.display)]);
    } catch {
      parsed.diagnostics.add('MATH_NOT_CONVERTED', '公式未转换：语法无效、超出公式处理范围或不支持该结构；已保留完整源码。', 'degradation', formula.line);
      formulas.set(formula.id, [new TextRun({ text: '[公式未转换] ', color: '92400E' }), ...formula.raw.split('\n').map((text, i) => new TextRun({ text, ...(i ? { break: 1 } : {}), font: 'Consolas' }))]);
    }
  }
  const { sections: bodySections, options, numbering, footnotes } = convertHTMLToDocx(html, images, parsed.diagnostics, formulas, lazyImages);
  for (const placement of placements) {
    const line = diagrams.get(placement.id)?.line;
    try {
      const image = await finishDiagram(prepared.get(placement.id)!, limits, placement.bounds);
      normalizedBytes += image.data.byteLength;
      if (normalizedBytes > limits.maxTotalImageBytes) throw new ExportError('Images and diagrams exceed the aggregate byte limit.', 'LIMIT_EXCEEDED');
      for (const note of image.styleNotes ?? []) parsed.diagnostics.add('MERMAID_STYLE_UNSUPPORTED', note, 'info', line);
      if (image.layoutAdjusted) parsed.diagnostics.add('MERMAID_LAYOUT_ADJUSTED', `横向流程图在 Word 中过窄，已改为纵向布局以保留节点与连线；调整后最小字号约 ${image.minTextPt.toFixed(1)} pt。`, 'info', line);
      if (image.minTextPt > 0 && image.minTextPt < 8) parsed.diagnostics.add('MERMAID_SMALL_TEXT', `图表缩放后最小字号约 ${image.minTextPt.toFixed(1)} pt，低于建议的 8 pt；请拆分图表、简化标签或调整布局。`, 'info', line);
      placement.run.target = createImageRun(image, placement.bounds, placement.alt);
    } catch (error) {
      if (error instanceof ExportError) throw error;
      // Rasterizing an SVG that already parsed and measured is not expected to fail.
      parsed.diagnostics.add('MERMAID_NOT_RENDERED', 'Mermaid rendering failed; placeholder text retained.', 'degradation', line);
      placement.run.target = new TextRun({ text: '[图片: Mermaid 图表]', italics: true, color: '6B7280' });
    }
  }
  const separateFront = bodySections[0].landscape && !!(options.title || options.toc);
  const front: FileChild[] = [];
  if (options.title) front.push(new Paragraph({ children: [new TextRun({ text: options.title, bold: true, size: 44, font: options.headingFont })], alignment: AlignmentType.CENTER, spacing: { after: 360 }, keepNext: true }));
  if (options.toc) {
    front.push(new Paragraph({ text: '目录', alignment: AlignmentType.CENTER, keepNext: true }), new TableOfContents('目录', { hyperlink: true, headingStyleRange: `1-${options.tocDepth}`, beginDirty: true }));
    // A separate front section already ends with a next-page section break.
    if (!separateFront) front.push(new Paragraph({ pageBreakBefore: true }));
  }
  const contentSections = separateFront
    ? [{ landscape: false, children: front }, ...bodySections]
    : bodySections.map((section, i) => ({ ...section, children: [...(i === 0 ? front : []), ...section.children] }));
  const runningText = { size: 20, font: options.font };
  const sections: ISectionOptions[] = contentSections.map(section => ({
    properties: { type: SectionType.NEXT_PAGE, page: {
      size: { width: PAGE_WIDTH, height: PAGE_HEIGHT, orientation: section.landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
      margin: { ...Object.fromEntries(Object.entries(options.margins).map(([key, value]) => [key, mmToTwips(value)])),
        ...(options.header ? { header: Math.min(708, mmToTwips(options.margins.top / 2)) } : {}),
        ...(options.footer || options.pageNumbers ? { footer: Math.min(708, mmToTwips(options.margins.bottom / 2)) } : {}),
      },
    } },
    ...(options.header ? { headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ ...runningText, text: options.header })], spacing: { line: 240, before: 0, after: 0 }, alignment: AlignmentType.CENTER })] }) } } : {}),
    ...(options.footer || options.pageNumbers ? { footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { line: 240, before: 0, after: 0 }, children: [
      ...(options.footer ? [new TextRun({ ...runningText, text: options.footer })] : []),
      ...(options.pageNumbers ? [new TextRun({ ...runningText, children: [options.footer ? '  ' : '', '第 ', PageNumber.CURRENT, ' 页 / 共 ', PageNumber.TOTAL_PAGES, ' 页'] })] : []),
    ] })] }) } } : {}),
    children: section.children,
  }));
  const document = new Document({ title: options.title || undefined, styles: createStyles(options), numbering, footnotes, features: { updateFields: true }, sections });
  const data = await Packer.toBuffer(document);
  if (data.byteLength > limits.maxOutputBytes) throw new ExportError('DOCX exceeds the configured output limit.', 'LIMIT_EXCEEDED');
  return { data, warnings: parsed.diagnostics.items };
}
async function normalizeImage(source: Uint8Array, limits: Limits): Promise<{ image: EmbeddedImage; animated: boolean }> {
  const input = Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  let data: Buffer;
  let width: number;
  let height: number;
  let type: EmbeddedImage['type'] = 'png';
  let animated = false;
  if (input.subarray(0, 2).toString() === 'BM') {
    if (input.length < 54 || input.readUInt32LE(14) !== 40 || input.readUInt32LE(30) !== 0 || ![24, 32].includes(input.readUInt16LE(28))) throw new Error('Unsupported BMP encoding');
    width = input.readInt32LE(18); height = Math.abs(input.readInt32LE(22));
    checkDimensions(width, height, limits);
    const row = Math.ceil(width * input.readUInt16LE(28) / 32) * 4;
    if (input.readUInt32LE(10) + row * height > input.length) throw new Error('Truncated BMP');
    const decoded = bmp.decode(input);
    const rgba = Buffer.alloc(decoded.data.length);
    for (let i = 0; i < rgba.length; i += 4) { rgba[i] = decoded.data[i + 3]; rgba[i + 1] = decoded.data[i + 2]; rgba[i + 2] = decoded.data[i + 1]; rgba[i + 3] = 255; }
    data = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
  } else {
    // Benign encoder warnings (common in camera JPEGs) must not reject an image; damaged data still fails.
    const decoder = sharp(input, { failOn: 'error', limitInputPixels: limits.maxImagePixels });
    const meta = await sharp(input, { limitInputPixels: false }).metadata();
    if (!['png', 'jpeg', 'gif'].includes(meta.format ?? '')) throw new Error('Unsupported image format');
    checkDimensions(meta.width, meta.height, limits);
    if (meta.format === 'jpeg') {
      // Word embeds JPEG natively; re-encoding photos as PNG inflates them several times over.
      // Word ignores EXIF orientation and may misrender CMYK, so only those are re-encoded.
      type = 'jpg';
      if ((meta.orientation ?? 1) === 1 && meta.space !== 'cmyk') {
        await decoder.stats(); // Full decode validates the stream without re-encoding.
        data = input; width = meta.width; height = meta.height;
      } else {
        const normalized = await decoder.rotate().toColourspace('srgb').jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
        data = normalized.data; width = normalized.info.width; height = normalized.info.height;
      }
    } else {
      const normalized = await decoder.rotate().png().toBuffer({ resolveWithObject: true });
      data = normalized.data; width = normalized.info.width; height = normalized.info.height;
      animated = (meta.pages ?? 1) > 1;
    }
  }
  if (data.byteLength > limits.maxImageBytes) throw new ExportError('Decoded image exceeds the configured byte limit.', 'LIMIT_EXCEEDED');
  return { image: { data, type, width, height }, animated };
}
function checkDimensions(width: number, height: number, limits: Limits): void {
  if (!(width > 0 && height > 0)) throw new Error('Invalid dimensions');
  if (width > limits.maxImageDimension || height > limits.maxImageDimension || width * height > limits.maxImagePixels) throw new ExportError('Image dimensions exceed the configured limit.', 'LIMIT_EXCEEDED');
}
