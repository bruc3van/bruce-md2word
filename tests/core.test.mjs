import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import sharp from 'sharp';
import bmp from 'bmp-js';
import { JSDOM } from 'jsdom';
import { Diagnostics } from '../lib/core/diagnostics.js';
import { defaults } from '../lib/config.js';
import { parseMarkdown } from '../lib/core/markdown.js';
import { convert } from '../lib/core/convert.js';
import { validateArtifact } from '../lib/runtime/artifact.js';
async function document(markdown, assets = [], limits = defaults) {
  const parsed = parseMarkdown(markdown, limits);
  const output = await convert(parsed, assets, [], limits);
  const zip = await JSZip.loadAsync(output.data);
  return { ...output, zip, xml: await zip.file('word/document.xml').async('string'), numbering: await zip.file('word/numbering.xml').async('string') };
}
test('CommonMark escaping, code whitespace, mixed styles, links and literal HTML survive', async () => {
  const result = await document('# 含 **重点** 的标题\n\nfoo_bar_baz \\*literal\\* **_混合格式_** ~~删除~~ [**bold**](https://example.com/a_(b)) <script>alert(1)</script>\n\n~~~js\n\nconst x = "<tag>";\n\n~~~');
  assert.match(result.xml, /foo_bar_baz \*literal\*/);
  assert.match(result.xml, /&lt;script&gt;/);
  assert.match(result.xml, /w:b/); assert.match(result.xml, /w:i/); assert.match(result.xml, /w:strike/);
  assert.match(result.xml, /w:pStyle w:val="Heading1"/);
  assert.match(result.xml, /w:br/);
  assert.match(await result.zip.file('word/_rels/document.xml.rels').async('string'), /https:\/\/example.com\/a_\(b\)/);
  const parsed = parseMarkdown('```js\n\nconst x = 1;\n\n```', defaults);
  assert.equal(parsed.html, '<pre><code class="language-js">\nconst x = 1;\n</code></pre>');
  assert.deepEqual(result.warnings, []);
});
test('independent lists restart, explicit starts and nested/loose lists retain content', async () => {
  const result = await document('3. first\n4. second\n   1. nested\n\n   continuation\n\n# Split\n\n1. again\n\n- bullet\n\n  ```js\n  code\n  ```\n\n> quote\n>\n> - quote list\n\n---');
  assert.match(result.numbering, /w:start w:val="3"/);
  for (const text of ['first', 'second', 'nested', 'continuation', 'again', 'bullet', 'code', 'quote list']) assert.ok(result.xml.includes(text), text);
  const ids = [...result.xml.matchAll(/<w:numId w:val="(\d+)"/g)].map(m => m[1]);
  assert.equal(ids[0], ids[1]); assert.notEqual(ids[0], ids[3]);
  assert.match(result.xml, /w:bottom/);
});

test('soft breaks separate formatted words in paragraphs, links and tight lists', async () => {
  const result = await document('**hello**\n**world**\n\n[linked](https://example.com)\n*word*\n\n- **list**\n  **item**\n- next\n\n**hard**  \n**break**');
  const dom = new JSDOM(result.xml, { contentType: 'text/xml' });
  try {
    const paragraphs = [...dom.window.document.getElementsByTagName('w:p')];
    assert.deepEqual(paragraphs.map(p => [...p.getElementsByTagName('w:t')].map(t => t.textContent).join('')), ['hello world', 'linked word', 'list item', 'next', 'hardbreak']);
    assert.equal(paragraphs[4].getElementsByTagName('w:br').length, 1);
    assert.deepEqual(result.warnings, []);
  } finally { dom.window.close(); }
});

test('zero-based lists retain zero in abstract and concrete numbering', async () => {
  const result = await document('0. zero\n1. one\n\n# Restart\n\n0. again');
  const dom = new JSDOM(result.numbering, { contentType: 'text/xml' });
  try {
    const nums = [...dom.window.document.getElementsByTagName('w:num')];
    const usedIds = [...result.xml.matchAll(/<w:numId w:val="(\d+)"/g)].map(m => m[1]);
    assert.equal(usedIds[0], usedIds[1]);
    assert.notEqual(usedIds[0], usedIds[2]);
    for (const id of new Set(usedIds)) {
      const num = nums.find(n => n.getAttribute('w:numId') === id);
      assert.equal(num.getElementsByTagName('w:startOverride')[0].getAttribute('w:val'), '0');
      const abstractId = num.getElementsByTagName('w:abstractNumId')[0].getAttribute('w:val');
      const abstract = [...dom.window.document.getElementsByTagName('w:abstractNum')].find(n => n.getAttribute('w:abstractNumId') === abstractId);
      assert.equal(abstract.getElementsByTagName('w:start')[0].getAttribute('w:val'), '0');
    }
  } finally { dom.window.close(); }
});

test('portrait images fit the page and preserve aspect ratio in paragraphs, lists and cells', async () => {
  const data = await sharp({ create: { width: 400, height: 1600, channels: 3, background: '#fff' } }).png().toBuffer();
  const result = await document('![portrait](x.png)\n\n- ![list](x.png)\n\n| image |\n| --- |\n| ![cell](x.png) |', Array.from({ length: 3 }, (_, i) => ({ id: `image-${i}`, data })));
  const extents = [...result.xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)];
  assert.equal(extents.length, 3);
  for (const [, cx, cy] of extents) {
    const width = Number(cx) / 9525, height = Number(cy) / 9525;
    assert.ok(height <= 740 && width > 0);
    assert.ok(Math.abs(height / width - 4) < 0.01);
  }
  assert.deepEqual(result.warnings, []);
});

test('diagnostic truncation preserves info and never hides an omitted degradation', () => {
  for (const severities of [['info', 'info', 'info'], ['degradation', 'info', 'info'], ['info', 'degradation', 'info'], ['info', 'info', 'degradation']]) {
    const diagnostics = new Diagnostics(1);
    for (const severity of severities) diagnostics.add('TEST', 'message', severity);
    assert.equal(diagnostics.items.length, 1);
    assert.equal(diagnostics.items[0].code, 'DIAGNOSTICS_TRUNCATED');
    assert.equal(diagnostics.items[0].severity, severities.includes('degradation') ? 'degradation' : 'info');
    assert.match(diagnostics.items[0].message, /\(3\)/);
  }
});
test('tables retain escaped pipes and explicit cell widths', async () => {
  const result = await document('| 左 | 右 |\n| :--- | ---: |\n| a\\|b | **c** |');
  assert.match(result.xml, /a\|b/); assert.match(result.xml, /w:tblGrid/); assert.match(result.xml, /w:tcW w:type="dxa"/);
});
test('PNG, JPEG, GIF and BMP are decoded and embedded as valid images', async () => {
  const raw = sharp({ create: { width: 12, height: 8, channels: 3, background: '#ff0000' } });
  const fixtures = [await raw.clone().png().toBuffer(), await raw.clone().jpeg().toBuffer(), await raw.clone().gif().toBuffer(), bmp.encode({ data: Buffer.alloc(12 * 8 * 4, 255), width: 12, height: 8 }).data];
  for (const data of fixtures) {
    const result = await document('![alt](image.png)', [{ id: 'image-0', data }]);
    assert.deepEqual(result.warnings, []);
    assert.match(result.xml, /w:drawing/);
    await validateArtifact(result.data, defaults.maxOutputBytes);
  }
});
test('damaged images preserve alternative text without copying embedded data into diagnostics', async () => {
  const result = await document('![可见](image.png)', [{ id: 'image-0', data: Buffer.from('not an image') }]);
  assert.match(result.xml, /图片: 可见/);
  assert.equal(result.warnings[0].code, 'IMAGE_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(result.warnings), /data:/);
});
test('image dimensions, image count and output limits fail before save', async () => {
  const data = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(document('![alt](image.png)', [{ id: 'image-0', data }], { ...defaults, maxImagePixels: 50 }), { code: 'LIMIT_EXCEEDED' });
  assert.throws(() => parseMarkdown('![a](a.png) ![b](b.png)', { ...defaults, maxImages: 1 }), { code: 'LIMIT_EXCEEDED' });
  await assert.rejects(document('x', [], { ...defaults, maxOutputBytes: 10 }), { code: 'LIMIT_EXCEEDED' });
});
test('diagnostics are bounded and keep strict degradation visible', async () => {
  const parsed = parseMarkdown(Array.from({ length: 5 }, () => '```mermaid\npie\n"A": 1\n```').join('\n\n'), { ...defaults, maxDiagnostics: 2 });
  await convert(parsed, [], [], { ...defaults, maxDiagnostics: 2 });
  assert.equal(parsed.diagnostics.items.length, 2);
  assert.equal(parsed.diagnostics.items[1].code, 'DIAGNOSTICS_TRUNCATED');
  assert.equal(parsed.diagnostics.items[1].severity, 'degradation');
});
test('DOCX integrity validator rejects missing media and corrupt XML', async () => {
  const data = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).png().toBuffer();
  const result = await document('![a](a.png)', [{ id: 'image-0', data }]);
  const media = Object.keys(result.zip.files).find(name => name.startsWith('word/media/') && !result.zip.files[name].dir);
  result.zip.remove(media);
  await assert.rejects(validateArtifact(await result.zip.generateAsync({ type: 'uint8array' }), defaults.maxOutputBytes), { code: 'CONVERSION_FAILED' });
  const valid = await document('x');
  valid.zip.file('word/document.xml', '<broken>');
  await assert.rejects(validateArtifact(await valid.zip.generateAsync({ type: 'uint8array' }), defaults.maxOutputBytes), { code: 'CONVERSION_FAILED' });
});

test('table alignment and meaningful Unicode spaces survive conversion', async () => {
  const result = await document('| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |\n\n甲\u00a0乙\u3000丙');
  const dom = new JSDOM(result.xml, { contentType: 'text/xml' });
  try {
    const aligns = [...dom.window.document.getElementsByTagName('w:jc')].map(n => n.getAttribute('w:val'));
    assert.deepEqual(aligns, ['left', 'center', 'right', 'left', 'center', 'right']);
    assert.ok(result.xml.includes('甲\u00a0乙\u3000丙'));
  } finally { dom.window.close(); }
});

test('standalone images use natural size, no first-line indent, and list images fit their container', async () => {
  const small = await sharp({ create: { width: 32, height: 16, channels: 3, background: '#fff' } }).png().toBuffer();
  const large = await sharp({ create: { width: 1200, height: 400, channels: 3, background: '#fff' } }).png().toBuffer();
  const result = await document('![small](s.png)\n\n- outer\n  - nested ![large](l.png)', [{ id: 'image-0', data: small }, { id: 'image-1', data: large }]);
  const dom = new JSDOM(result.xml, { contentType: 'text/xml' });
  try {
    const d = dom.window.document;
    const extents = [...d.getElementsByTagName('wp:extent')];
    assert.equal(Number(extents[0].getAttribute('cx')) / 9525, 32);
    assert.equal(Number(extents[0].getAttribute('cy')) / 9525, 16);
    assert.ok(Number(extents[1].getAttribute('cx')) / 9525 <= (9072 - 1440) / 15);
    const p = d.getElementsByTagName('w:p')[0];
    assert.equal(p.getElementsByTagName('w:ind')[0].getAttribute('w:firstLine'), '0');
    assert.equal(p.getElementsByTagName('w:jc')[0].getAttribute('w:val'), 'center');
  } finally { dom.window.close(); }
});

test('internal links target unique heading bookmarks, including Chinese and duplicate slugs', async () => {
  const result = await document('[first](#intro) [second](#intro-1) [中文](#%E4%B8%AD%E6%96%87)\n\n# Intro\n\n# Intro\n\n# 中文');
  const dom = new JSDOM(result.xml, { contentType: 'text/xml' });
  try {
    const d = dom.window.document;
    const names = [...d.getElementsByTagName('w:bookmarkStart')].map(n => n.getAttribute('w:name'));
    assert.equal(new Set(names).size, 3);
    assert.deepEqual([...d.getElementsByTagName('w:hyperlink')].map(n => n.getAttribute('w:anchor')), names);
    assert.deepEqual(result.warnings, []);
    assert.doesNotMatch(await result.zip.file('word/_rels/document.xml.rels').async('string'), /Target="#/);
  } finally { dom.window.close(); }
  const missing = await document('[missing](#absent)');
  assert.match(missing.xml, /missing/);
  assert.equal(missing.warnings[0].code, 'LINK_UNAVAILABLE');
});

test('unsupported footnotes retain definition text, warn with source line, and leave code and normal references alone', async () => {
  const result = await document('说明[^1]\n\n[^1]: 脚注内容\n    第二行\n\n[normal][ref]\n\n[ref]: https://example.com\n\n```txt\n[^2]: code\n```');
  for (const text of ['说明[^1]', '[^1]: 脚注内容', '第二行', '[^2]: code']) assert.ok(result.xml.includes(text), text);
  assert.deepEqual(result.warnings.map(w => [w.code, w.line]), [['FOOTNOTE_NOT_CONVERTED', 3]]);
  assert.match(await result.zip.file('word/_rels/document.xml.rels').async('string'), /https:\/\/example.com/);
});

test('list text, continuation paragraphs and nested blocks share a container without changing restart semantics', async () => {
  const result = await document('3. outer\n\n   continued\n\n   5. nested\n\n      ```txt\n      code\n      ```\n\n      | A | B |\n      | - | - |\n      | a | b |\n\n4. back\n\n# Chapter\n\n1. restart\n\n# Explicit\n\n7. seven\n\n> - quoted');
  const dom = new JSDOM(result.xml, { contentType: 'text/xml' });
  try {
    const d = dom.window.document;
    const ps = [...d.getElementsByTagName('w:p')];
    const p = text => ps.find(p => [...p.getElementsByTagName('w:t')].map(t => t.textContent).join('') === text);
    const ind = text => p(text).getElementsByTagName('w:ind')[0];
    assert.equal(ind('outer').getAttribute('w:left'), '720');
    assert.equal(ind('outer').getAttribute('w:hanging'), '480');
    assert.equal(ind('outer').hasAttribute('w:firstLine'), false);
    assert.equal(ind('continued').getAttribute('w:left'), '720');
    assert.equal(p('continued').getElementsByTagName('w:numPr').length, 0);
    assert.equal(ind('nested').getAttribute('w:left'), '1440');
    assert.equal(ind('code').getAttribute('w:left'), '1680');
    assert.equal(d.getElementsByTagName('w:tblW')[0].getAttribute('w:w'), String(9072 - 1440));
    assert.equal(ind('quoted').getAttribute('w:left'), '1200');
    const id = text => p(text).getElementsByTagName('w:numId')[0].getAttribute('w:val');
    assert.equal(id('outer'), id('back'));
    assert.notEqual(id('outer'), id('restart'));
    assert.notEqual(id('restart'), id('seven'));
    assert.match(result.numbering, /w:start w:val="7"/);
  } finally { dom.window.close(); }
});
