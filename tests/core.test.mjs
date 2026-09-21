import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import sharp from 'sharp';
import bmp from 'bmp-js';
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
