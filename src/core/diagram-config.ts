import JSON5 from 'json5';
import { parseDocument } from 'yaml';
import type { RenderOptions } from 'beautiful-mermaid';
import { parseDiagramFontSize, parseDiagramDash } from './diagram-style.js';

const themes: Record<string, RenderOptions> = {
  default: { bg: '#ffffff', fg: '#1f2937', line: '#64748b', accent: '#2563eb', muted: '#475569', surface: '#f1f5f9', border: '#94a3b8' },
  base: { bg: '#ffffff', fg: '#333333', line: '#333333', accent: '#333333', muted: '#555555', surface: '#fff4dd', border: '#aa9966' },
  dark: { bg: '#1f2020', fg: '#eeeeee', line: '#cccccc', accent: '#cccccc', muted: '#cccccc', surface: '#303030', border: '#aaaaaa' },
  forest: { bg: '#ffffff', fg: '#1f3322', line: '#52734d', accent: '#52734d', muted: '#42633f', surface: '#e7f3df', border: '#52734d' },
  neutral: { bg: '#ffffff', fg: '#222222', line: '#555555', accent: '#555555', muted: '#555555', surface: '#eeeeee', border: '#777777' },
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Mermaid configuration must be an object');
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).some(k => ['__proto__', 'constructor', 'prototype'].includes(k))) throw new Error('Unsupported configuration key');
  return obj;
};
const color = (value: unknown): string => {
  if (typeof value !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) throw new Error('Theme colors require #RGB or #RRGGBB');
  return value.length === 4 ? '#' + [...value.slice(1)].map(c => c + c).join('') : value;
};

/** Explicit subset: do not silently accept unsupported layout/content controls. */
export function prepareDiagram(source: string): { source: string; options: RenderOptions; notes: string[] } {
  let text = source.replace(/\r\n?/g, '\n').trim();
  let config: Record<string, unknown> = {};
  const notes: string[] = [];
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---', 4);
    if (end < 0 || !/^\n---(?:\n|$)/.test(text.slice(end))) throw new Error('Invalid Mermaid frontmatter');
    const doc = parseDocument(text.slice(4, end), { uniqueKeys: true, schema: 'core' });
    if (doc.errors.length || doc.warnings.length) throw new Error('Invalid Mermaid YAML');
    const front = record(doc.toJS({ maxAliasCount: 0 }));
    if (Object.keys(front).some(k => k !== 'config')) throw new Error('Unsupported Mermaid frontmatter field');
    config = record(front.config ?? {});
    text = text.slice(end + 4).trim();
  }
  text = text.replace(/^\s*%%\{\s*(?:init|initialize)\s*:\s*([\s\S]*?)\}%%\s*$/gm, (_, raw: string) => {
    const next = record(JSON5.parse(raw));
    config = { ...config, ...next, themeVariables: { ...record(config.themeVariables ?? {}), ...record(next.themeVariables ?? {}) } };
    return '';
  });
  if (/^\s*(?:%%\{|---|click\s)/m.test(text)) throw new Error('Unsupported Mermaid configuration');
  text = text.split('\n').filter(line => !line.trim().startsWith('%%')).join('\n').trim();
  for (const line of text.split('\n')) {
    const declaration = /^\s*(style|classDef|linkStyle)\s+(?:default|[\d,\s]+|[\w,-]+)\s+(.+)$/.exec(line);
    if (!declaration) continue;
    const allowed = declaration[1] === 'linkStyle'
      ? ['stroke', 'stroke-width', 'stroke-dasharray']
      : ['fill', 'stroke', 'stroke-width', 'color', 'font-size', 'stroke-dasharray'];
    for (const pair of declaration[2].replace(/;\s*$/, '').split(/(?<!\\),/)) {
      const colon = pair.indexOf(':');
      const key = pair.slice(0, colon).trim();
      const value = pair.slice(colon + 1).trim().replace(/\\,/g, ',');
      if (!allowed.includes(key)) notes.push('部分 style/classDef/linkStyle 属性未应用；请检查导出图表的样式。');
      else if ((key === 'font-size' && parseDiagramFontSize(value) === undefined)
        || (key === 'stroke-dasharray' && parseDiagramDash(value) === undefined)) {
        notes.push(`不支持的 ${key} 样式值已忽略，使用默认样式。`);
      }
    }
  }
  const options = { ...themes.default };
  if (config.theme !== undefined) {
    if (typeof config.theme !== 'string' || !Object.hasOwn(themes, config.theme)) throw new Error('Unsupported Mermaid theme');
    Object.assign(options, themes[config.theme]);
  }
  for (const key of Object.keys(config)) {
    if (!['theme', 'themeVariables', 'flowchart'].includes(key)) throw new Error('Unsupported Mermaid configuration field');
  }
  const mapping: Record<string, keyof RenderOptions> = { background: 'bg', primaryColor: 'surface', primaryTextColor: 'fg', textColor: 'fg', primaryBorderColor: 'border', lineColor: 'line' };
  for (const [key, value] of Object.entries(record(config.themeVariables ?? {}))) {
    if (Object.hasOwn(mapping, key)) {
      Object.assign(options, { [mapping[key]]: color(value) });
      if (key === 'lineColor') options.accent = color(value);
    } else notes.push('部分主题变量未应用；支持背景、主节点填充、文字、边框与连线颜色。');
  }
  if (config.flowchart !== undefined) {
    if (!/^(flowchart|graph)\b/i.test(text)) throw new Error('Flowchart settings require a flowchart');
    for (const [key, value] of Object.entries(record(config.flowchart))) {
      if (!['nodeSpacing', 'rankSpacing'].includes(key) || typeof value !== 'number' || !Number.isFinite(value) || value < 8 || value > 200) throw new Error('Unsupported flowchart settings');
      if (key === 'nodeSpacing') options.nodeSpacing = value;
      else options.layerSpacing = value;
    }
  }
  return { source: text, options, notes: [...new Set(notes)] };
}
