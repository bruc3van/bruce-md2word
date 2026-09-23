import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import JSZip from 'jszip';
import { renderMermaidSVG } from '../lib/core/mermaid-renderer.js';
import { wrapDiagramLabel } from '../lib/core/diagram-layout.js';
import { JSDOM } from 'jsdom';
import { renderDiagram, staticDiagramSvg } from '../lib/core/mermaid.js';
import { parseMarkdown } from '../lib/core/markdown.js';
import { convert } from '../lib/core/convert.js';
import { defaults } from '../lib/config.js';
import { validateArtifact } from '../lib/runtime/artifact.js';
import { harness } from './harness.mjs';
const source = text => ({ source: { kind: 'markdown', text } });
const code = result => result.error?.info?.code;

const fence = text => '```mermaid\n' + text + '\n```';
const chinese = await readFile(new URL('../fixtures/Mermaid中文.md', import.meta.url), 'utf8');

test('Chinese fixtures for all six diagram types embed seven valid PNGs in DOCX', async () => {
  const parsed = parseMarkdown(chinese, defaults);
  assert.equal(parsed.diagrams.length, 7);
  assert.equal(parsed.images.length, 0); // Generated graphics never use the file reader.
  const result = await convert(parsed, [], [], defaults);
  assert.ok(result.warnings.every(w => ['MERMAID_SMALL_TEXT', 'MERMAID_LAYOUT_ADJUSTED'].includes(w.code) && w.severity === 'info'));
  await validateArtifact(result.data, defaults.maxOutputBytes);
  const zip = await JSZip.loadAsync(result.data);
  const media = Object.values(zip.files).filter(f => !f.dir && f.name.startsWith('word/media/'));
  assert.equal(media.length, 7);
  for (const entry of media) {
    const png = await entry.async('nodebuffer');
    const meta = await sharp(png).metadata();
    assert.equal(meta.format, 'png');
    assert.ok(meta.width > 100 && meta.height > 100);
    const stats = await sharp(png).stats();
    assert.ok(stats.channels.some(c => c.stdev > 10)); // A real drawing, not a blank raster.
  }
  const xml = await zip.file('word/document.xml').async('string');
  assert.equal((xml.match(/<w:drawing>/g) ?? []).length, 7);
  assert.doesNotMatch(xml, /flowchart TD|sequenceDiagram/);
  for (const match of xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)) {
    assert.ok(Number(match[1]) <= 560 * 9525);
    assert.ok(Number(match[2]) <= 741 * 9525);
  }
});

test('bundled renderer omits web fonts before raster adaptation', async () => {
  const bundle = await readFile(new URL('../lib/core/mermaid-renderer.js', import.meta.url), 'utf8');
  assert.doesNotMatch(bundle, /fonts\.googleapis\.com/);
  for (const source of ['graph LR\nA[中文] --> B[完成]', 'classDiagram\nclass User {\n+String name\n}']) {
    const svg = renderMermaidSVG(source);
    assert.doesNotMatch(svg, /@import|fonts\.googleapis\.com/);
    assert.match(svg, /<text/);
  }
});

test('SVG raster adapter preserves Chinese labels and resolves offline colors/fonts', () => {
  const svg = staticDiagramSvg(renderMermaidSVG('graph LR\nA[中文标签] --> B[English 混排]'));
  assert.match(svg, /中文标签/); assert.match(svg, /English 混排/);
  assert.match(svg, /Microsoft YaHei/);
  assert.doesNotMatch(svg, /@import|fonts\.googleapis|var\(|color-mix\(/);
  assert.throws(() => staticDiagramSvg('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x"/></svg>'));
});

test('wide LR flowchart reflows to readable TB without dropping its branches', async () => {
  const source = `flowchart LR
    A[Agent 起草 Markdown] --> B[工程师复核]
    B --> C{严格转换通过?}
    C -- 是 --> D[生成 Word]
    C -- 否 --> E[修正源稿]
    E --> B
    D --> F[打开并检查版面]`;
  const image = await renderDiagram(source, defaults);
  assert.equal(image.layoutAdjusted, true);
  assert.ok(image.minTextPt >= 8);
  assert.ok(image.height > image.width);
  const parsed = parseMarkdown(fence(source), defaults);
  const result = await convert(parsed, [], [], defaults);
  assert.deepEqual(result.warnings.map(w => w.code), ['MERMAID_LAYOUT_ADJUSTED']);
  const zip = await JSZip.loadAsync(result.data);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /<w:drawing>/);
  assert.doesNotMatch(xml, /严格转换通过|修正源稿/); // Rendered into the image.
  const simple = await renderDiagram('graph LR\nA[开始] --> B[结束]', defaults);
  assert.equal(simple.layoutAdjusted, false);
});

test('reflow and readability diagnostics use final section dimensions and margins', async () => {
  const chain = count => 'graph LR\n' + Array.from({ length: count }, (_, i) => `N${i}[处理步骤${i}]`).join('-->');
  for (const [prefix, count, adjusted] of [
    ['', 13, true],
    ['<!-- word:section landscape -->\n\n', 13, false],
    ['<!-- word:document {"margins":{"top":50,"bottom":50}} -->\n\n', 16, false],
  ]) {
    const result = await convert(parseMarkdown(prefix + fence(chain(count)), defaults), [], [], defaults);
    assert.deepEqual(result.warnings.map(w => w.code), [adjusted ? 'MERMAID_LAYOUT_ADJUSTED' : 'MERMAID_SMALL_TEXT']);
    const zip = await JSZip.loadAsync(result.data);
    const xml = await zip.file('word/document.xml').async('string');
    const extent = xml.match(/<wp:extent cx="(\d+)" cy="(\d+)"/);
    const media = Object.values(zip.files).find(f => !f.dir && f.name.startsWith('word/media/'));
    const meta = await sharp(await media.async('nodebuffer')).metadata();
    // These nodes use 13 px text in the source SVG; PNG is rendered at 2x.
    const actualPt = 13 * 0.75 * (Number(extent[1]) / 9525) / (meta.width / 2);
    assert.equal(actualPt >= 8, adjusted);
    const reportedPt = Number(result.warnings[0].message.match(/约 ([\d.]+) pt/)[1]);
    assert.ok(Math.abs(reportedPt - actualPt) < 0.06, `${reportedPt} vs ${actualPt}`);
  }
  const result = await convert(parseMarkdown('<!-- word:section landscape -->\n\n' + fence(chain(13)) +
    '\n\n<!-- word:section portrait -->\n\n' + fence(chain(13)), defaults), [], [], defaults);
  assert.deepEqual(result.warnings.map(w => w.code), ['MERMAID_SMALL_TEXT', 'MERMAID_LAYOUT_ADJUSTED']);
});

test('an oversized vertical PNG falls back to the original graph within the byte budget', async () => {
  // Locate a case using the installed fonts, since PNG compression varies by host.
  let checked = false;
  for (let count = 10; count <= 16; count++) {
    const source = 'graph LR\n' + Array.from({ length: count }, (_, i) => `N${i}[处理步骤${i}]`).join('-->');
    const original = await renderDiagram(source, defaults, { maxWidth: 560, maxHeight: 1 });
    const vertical = await renderDiagram(source, defaults);
    if (!vertical.layoutAdjusted || vertical.data.length <= original.data.length) continue;
    const result = await renderDiagram(source, { ...defaults, maxImageBytes: original.data.length });
    assert.equal(result.layoutAdjusted, false);
    assert.deepEqual(result.data, original.data);
    assert.ok(result.minTextPt < 8);
    checked = true;
    break;
  }
  assert.ok(checked, 'fixture must exercise a vertical PNG larger than its original');
});

test('unsupported types, directives, empty diagrams and ER comments retain source with line diagnostics', async () => {
  for (const diagram of ['pie\n"中文": 10', '%%{init: {}}%%\ngraph TD\nA-->B', 'graph TD', 'erDiagram\nUSER {\n string name "姓名"\n}']) {
    const parsed = parseMarkdown('# 标题\n\n' + fence(diagram), defaults);
    const result = await convert(parsed, [], [], defaults);
    assert.equal(result.warnings[0].code, 'MERMAID_NOT_RENDERED');
    assert.equal(result.warnings[0].line, 3);
    const zip = await JSZip.loadAsync(result.data);
    const xml = await zip.file('word/document.xml').async('string');
    assert.match(xml, /w:pStyle w:val="CodeBlock"/);
    assert.match(xml, /Mermaid 图表未渲染（源文件第 3 行）/);
  }
});

test('Mermaid shares image count/bytes/pixels budgets and has a source cap', async () => {
  const diagram = 'graph TD\nA[中文]-->B[完成]';
  assert.throws(() => parseMarkdown(fence(diagram) + '\n![x](x.png)', { ...defaults, maxImages: 1 }), { code: 'LIMIT_EXCEEDED' });
  assert.throws(() => parseMarkdown('![x](x.png)\n' + fence(diagram), { ...defaults, maxImages: 1 }), { code: 'LIMIT_EXCEEDED' });
  await assert.rejects(renderDiagram(diagram, { ...defaults, maxImagePixels: 100 }), { code: 'LIMIT_EXCEEDED' });
  await assert.rejects(renderDiagram(diagram, { ...defaults, maxImageBytes: 10 }), { code: 'LIMIT_EXCEEDED' });
  await assert.rejects(renderDiagram('graph TD\n' + 'A'.repeat(50000), defaults), { code: 'LIMIT_EXCEEDED' });
  await assert.rejects(convert(parseMarkdown(fence(diagram), defaults), [], [], { ...defaults, maxTotalImageBytes: 10 }), { code: 'LIMIT_EXCEEDED' });
});

test('native DSH worker renders valid Mermaid in strict mode and rejects unsupported charts before saving', async () => {
  const h = await harness();
  try {
    const success = await h.call({ ...source(fence('sequenceDiagram\n用户->>服务: 中文请求\n服务-->>用户: 已完成')), strict: true });
    assert.equal(success.isError, false, JSON.stringify(success));
    assert.deepEqual(success.value.warnings, []);
    const zip = await JSZip.loadAsync(await h.bytes(success.value.attachment));
    assert.match(await zip.file('word/document.xml').async('string'), /w:drawing/);
    let saved = false;
    h.ctx.attachments.saveFile = async () => { saved = true; throw new Error('unexpected save'); };
    const failed = await h.call({ ...source(fence('pie\n"甲": 1')), strict: true });
    assert.equal(code(failed), 'CONTENT_INCOMPLETE');
    assert.equal(saved, false);
  } finally { await h.close(); }
});


test('Chinese class signatures stay inside the actual rasterized class box', async () => {
  const source = 'classDiagram\nclass 用户账户 {\n+修改密码(旧密码, 新密码) 布尔\n+创建订单(用户编号) 订单\n}';
  const svg = staticDiagramSvg(renderMermaidSVG(source));
  const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
  try {
    const group = dom.window.document.querySelector('.class-node');
    const box = group.querySelector('rect');
    const right = (Number(box.getAttribute('x')) + Number(box.getAttribute('width'))) * 2;
    const { data, info } = await sharp(Buffer.from(svg), { density: 144 }).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let visible = 0;
    for (const text of group.querySelectorAll('text.mono')) {
      const y = Number(text.getAttribute('y')) * 2;
      for (let row = Math.floor(y - 10); row < y + 12; row++) for (let x = 0; x < info.width; x++) {
        const offset = (row * info.width + x) * info.channels;
        const dark = data[offset] < 130 && data[offset + 1] < 130 && data[offset + 2] < 150;
        if (dark) { visible++; assert.ok(x <= right, `text ink at ${x} exceeds class border ${right}`); }
      }
    }
    assert.ok(visible > 100, 'Text must actually be rasterized');
  } finally { dom.window.close(); }
});

test('long parsed labels wrap before layout without losing Chinese, words or explicit breaks', () => {
  const text = '这是一个很长的节点标签：用于测试在横向空间不足时文本如何自动换行与缩放后的可读性 v3.14.159';
  const wrapped = wrapDiagramLabel(text);
  assert.ok(wrapped.split('\n').length >= 3);
  assert.equal(wrapped.replace(/\s/g, ''), text.replace(/\s/g, ''));
  assert.ok(wrapped.includes('v3.14.159'));
  assert.equal(wrapDiagramLabel('第一行\n第二行'), '第一行\n第二行');
  assert.equal(wrapDiagramLabel('<b>保持样式</b>'), '<b>保持样式</b>');
  assert.equal(wrapDiagramLabel('a👨‍👩‍👧‍👦e\u0301', 2), 'a\n👨‍👩‍👧‍👦\ne\u0301');
  const dom = new JSDOM(renderMermaidSVG(`graph TD\nA["${text}"]-->B[完成]`), { contentType: 'image/svg+xml' });
  try {
    const node = dom.window.document.querySelector('.node[data-id="A"]');
    assert.ok(node.querySelectorAll('tspan').length >= 3);
    assert.ok(Number(node.querySelector('rect').getAttribute('width')) < 300);
    assert.equal(dom.window.document.querySelectorAll('.node').length, 2);
  } finally { dom.window.close(); }
});

test('small-text warnings identify the fence and do not block strict delivery', async () => {
  const diagram = 'sequenceDiagram\n' + Array.from({ length: 8 }, (_, i) => `participant P${i} as 服务节点${i}`).join('\n') + '\nP0->>P7: 完成';
  const h = await harness();
  try {
    const r = await h.call({ ...source('# 宽图\n\n' + fence(diagram)), strict: true });
    assert.equal(r.isError, false, JSON.stringify(r));
    assert.equal(r.value.warnings[0].code, 'MERMAID_SMALL_TEXT');
    assert.equal(r.value.warnings[0].severity, 'info');
    assert.equal(r.value.warnings[0].line, 3);
    assert.match(r.value.warnings[0].message, /pt/);
  } finally { await h.close(); }
});

test('unconsumed state statements retain source and strict mode rejects the export', async () => {
  const h = await harness();
  try {
    for (const statement of ['note right of Active : 必须保留的说明', 'note left of Active\n多行说明\nend note', 'unsupported_statement']) {
      const text = fence('stateDiagram-v2\n[*] --> Active\n' + statement);
      const normal = await h.call(source(text));
      assert.equal(normal.isError, false, JSON.stringify(normal));
      assert.equal(normal.value.warnings[0].code, 'MERMAID_NOT_RENDERED');
      const zip = await JSZip.loadAsync(await h.bytes(normal.value.attachment));
      const xml = await zip.file('word/document.xml').async('string');
      assert.ok(xml.includes(statement.split('\n')[0]));
      assert.doesNotMatch(xml, /<w:drawing>/);
      const strict = await h.call({ ...source(text), strict: true });
      assert.equal(strict.isError, true);
      assert.equal(code(strict), 'CONTENT_INCOMPLETE');
    }
    // Notes are supported by the sequence parser and must keep rendering.
    const sequence = await h.call({ ...source(fence('sequenceDiagram\nA->>B: Request\nNote right of B: 保留说明')), strict: true });
    assert.equal(sequence.isError, false, JSON.stringify(sequence));
    assert.deepEqual(sequence.value.warnings, []);
  } finally { await h.close(); }
});

test('truncated readability hints do not reject strict export but omitted degradation does', async () => {
  const h = await harness({ maxDiagnostics: 1 });
  const graph = 'graph LR\n' + Array.from({ length: 10 }, (_, i) => `N${i}[处理步骤${i}]`).join('-->');
  const text = fence(graph) + '\n\n' + fence(graph);
  try {
    const result = await h.call({ ...source(text), strict: true });
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.equal(result.value.warnings.length, 1);
    assert.equal(result.value.warnings[0].code, 'DIAGNOSTICS_TRUNCATED');
    assert.equal(result.value.warnings[0].severity, 'info');
    const incomplete = await h.call({ ...source(text + '\n\n' + fence('pie\n"A": 1')), strict: true });
    assert.equal(incomplete.isError, true);
    assert.equal(code(incomplete), 'CONTENT_INCOMPLETE');
  } finally { await h.close(); }
});
