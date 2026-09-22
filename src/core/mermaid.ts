import { JSDOM } from 'jsdom';
import sharp from 'sharp';
import type { Limits } from '../config.js';
import type { EmbeddedImage } from './html-to-docx.js';
import { ExportError } from '../runtime/errors.js';
import { MAX_IMAGE_HEIGHT } from './styles.js';

// All fonts are resolved locally. No web fonts or browser runtime are used.
export const DIAGRAM_FONT = 'PingFang SC, Microsoft YaHei, Noto Sans CJK SC, WenQuanYi Micro Hei, sans-serif';
const palette: Record<string, string> = {
  '--bg': '#ffffff', '--fg': '#1f2937', '--line': '#64748b', '--accent': '#2563eb',
  '--muted': '#475569', '--surface': '#f1f5f9', '--border': '#94a3b8',
};

/** Resolve the pinned renderer's CSS theme for librsvg, which lacks CSS variables. */
export function staticDiagramSvg(svg: string): string {
  const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
  try {
    const doc = dom.window.document;
    const root = doc.documentElement;
    const variables = new Map(Object.entries(palette));
    const declaration = /(--[\w-]+)\s*:\s*([^;}\n]+)/g;
    const styles = Array.from(doc.querySelectorAll('style'));
    for (const style of styles) for (const match of (style.textContent ?? '').matchAll(declaration)) variables.set(match[1], match[2].trim());
    const resolve = (input: string): string => {
      let result = input;
      for (let i = 0; i < 20 && /var\(|color-mix\(/.test(result); i++) {
        result = result.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g, (_, key: string, fallback: string) => variables.get(key) ?? fallback ?? '');
        result = result.replace(/color-mix\(in srgb,\s*(#[\da-f]{6})\s+(\d+(?:\.\d+)?)%,\s*(#[\da-f]{6})(?:\s+(\d+(?:\.\d+)?)%)?\)/gi, (_, a: string, weight: string, b: string) => {
          const ratio = Number(weight) / 100;
          return '#' + [1, 3, 5].map(offset => Math.round(parseInt(a.slice(offset, offset + 2), 16) * ratio + parseInt(b.slice(offset, offset + 2), 16) * (1 - ratio)).toString(16).padStart(2, '0')).join('');
        });
      }
      if (/var\(|color-mix\(/.test(result)) throw new Error('Unsupported diagram colors');
      return result;
    };
    for (const style of styles) style.textContent = resolve((style.textContent ?? '').replace(/@import[^;]*;/g, '').replace(declaration, ''));
    root.removeAttribute('style');
    for (const el of Array.from(doc.querySelectorAll('*'))) {
      if (['script', 'foreignObject', 'image', 'use', 'a', 'animate', 'set'].includes(el.localName)) throw new Error('Unsupported SVG element');
      for (const attr of Array.from(el.attributes)) {
        if (/^on/i.test(attr.name) || attr.localName === 'href') throw new Error('External SVG reference');
        if (attr.name === 'fill' || attr.name === 'stroke' || attr.name === 'style') el.setAttribute(attr.name, resolve(attr.value));
      }
      if (el.localName === 'text') el.setAttribute('font-family', DIAGRAM_FONT);
    }
    // Override the renderer's Inter/JetBrains CSS, including member labels.
    const fontStyle = doc.createElementNS(root.namespaceURI, 'style');
    fontStyle.textContent = `text, .mono { font-family: ${DIAGRAM_FONT}; }`;
    root.append(fontStyle);
    const result = root.outerHTML;
    if (/@import|url\(\s*(?!#[\w-]+\s*\))[^)]*\)/i.test(result)) throw new Error('External SVG resource');
    return result;
  } finally { dom.window.close(); }
}

export interface RenderedDiagram extends EmbeddedImage { minTextPt: number }

export async function renderDiagram(source: string, limits: Limits): Promise<RenderedDiagram> {
  if (Buffer.byteLength(source) > 50_000) throw new ExportError('Mermaid source exceeds the 50 KB diagram limit.', 'LIMIT_EXCEEDED');
  // The lightweight parser silently ignores some official directives; fail visibly.
  if (/^\s*(?:%%\{|---|click\s)/m.test(source)) throw new Error('Unsupported Mermaid configuration');
  const normalized = source.split('\n').filter(line => !line.trim().startsWith('%%')).join('\n').trim();
  if (!/^(?:(?:flowchart|graph)\s+(?:TD|TB|BT|LR|RL)\b|stateDiagram(?:-v2)?\b|sequenceDiagram\b|classDiagram\b|erDiagram\b|xychart(?:-beta)?\b)/i.test(normalized)) throw new Error('Unsupported Mermaid diagram type');
  if (/^erDiagram\b/i.test(normalized) && /^\s*\S+\s+\S+(?:\s+(?:PK|FK|UK)[,\s]*)*\s+"[^"]*"\s*$/m.test(normalized)) throw new Error('ER field comments are not rendered');
  const { renderMermaidSVG } = await import('./mermaid-renderer.js');
  const svg = staticDiagramSvg(renderMermaidSVG(normalized, {
    font: 'sans-serif', bg: palette['--bg'], fg: palette['--fg'], line: palette['--line'],
    accent: palette['--accent'], muted: palette['--muted'], surface: palette['--surface'], border: palette['--border'],
    padding: 24, interactive: false,
  }));
  if (!/<text\b/.test(svg)) throw new Error('Empty diagram');
  if (Buffer.byteLength(svg) > limits.maxImageBytes) throw new ExportError('Mermaid SVG exceeds the configured byte limit.', 'LIMIT_EXCEEDED');
  // 2x pixels keep labels crisp at their intended Word display size.
  const input = Buffer.from(svg);
  const meta = await sharp(input, { density: 144, limitInputPixels: false }).metadata();
  const width = meta.width ?? 0, height = meta.height ?? 0;
  if (!(width > 0 && height > 0) || width > limits.maxImageDimension || height > limits.maxImageDimension || width * height > limits.maxImagePixels) throw new ExportError('Mermaid dimensions exceed the configured limit.', 'LIMIT_EXCEEDED');
  const data = await sharp(input, { density: 144, limitInputPixels: limits.maxImagePixels }).flatten({ background: '#ffffff' }).png().toBuffer();
  if (data.byteLength > limits.maxImageBytes) throw new ExportError('Mermaid PNG exceeds the configured byte limit.', 'LIMIT_EXCEEDED');
  const displayWidth = Math.min(width / 2, 560, MAX_IMAGE_HEIGHT * width / height);
  const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
  let minFontSize: number;
  try {
    const sizes = Array.from(dom.window.document.querySelectorAll('text[font-size]')).map(el => Number(el.getAttribute('font-size'))).filter(size => size > 0);
    minFontSize = sizes.length ? Math.min(...sizes) : 0;
  } finally { dom.window.close(); }
  return { data, type: 'png', width, height, displayWidth, minTextPt: minFontSize * (displayWidth / (width / 2)) * 0.75 };
}
