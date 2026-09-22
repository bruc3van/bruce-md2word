import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';
import { harness } from './harness.mjs';
const source = text => ({ source: { kind: 'markdown', text } });
const code = result => result.error?.info?.code;
test('real DSH registry exports a retrievable DOCX and disposes registrations', async () => {
  const h = await harness();
  try {
    const result = await h.call(source('# 中文标题\n\n**重点**，正文与 [链接](https://example.com)\n\n1. first\n2. second'));
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.equal(result.value.fileName, 'document.docx');
    assert.equal(result.content[1].type, 'file');
    const bytes = await h.bytes(result.value.attachment);
    assert.equal(bytes.length, result.value.sizeBytes);
    const zip = await JSZip.loadAsync(bytes);
    assert.match(await zip.file('word/document.xml').async('string'), /中文标题/);
    const saved = JSON.parse(JSON.stringify(result.content[1].attachment));
    assert.deepEqual(await h.bytes(saved), bytes);
    await h.fiber.dispose();
    assert.equal(h.ctx.tools.get('word_export'), undefined);
  } finally { await h.close(); }
});
test('file mode reads BOM UTF-8 and embeds relative images from tables and lists', async () => {
  const h = await harness();
  try {
    const png = await sharp({ create: { width: 20, height: 10, channels: 4, background: '#ff0000' } }).png().toBuffer();
    await writeFile(path.join(h.root, 'image.png'), png);
    await writeFile(path.join(h.root, '报告.md'), '\uFEFF# 报告\n\n| 图片 | 内容 |\n|---|---|\n| ![表格图片](image.png) | 表格 |\n\n- ![列表图片](image.png)');
    const result = await h.call({ source: { kind: 'file', path: '报告.md' } });
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.equal(result.value.fileName, '报告.docx');
    assert.deepEqual(result.value.warnings, []);
    const zip = await JSZip.loadAsync(await h.bytes(result.value.attachment));
    assert.ok(Object.keys(zip.files).some(name => name.startsWith('word/media/') && !zip.files[name].dir));
    assert.match(await zip.file('word/document.xml').async('string'), /w:tbl/);
  } finally { await h.close(); }
});
test('missing images and unsupported Mermaid are visible degradations; strict saves no attachment', async () => {
  const h = await harness();
  try {
    const args = source('![missing](missing.png)\n\n~~~mermaid\npie\n"A": 1\n~~~');
    const result = await h.call(args);
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.deepEqual(new Set(result.value.warnings.map(w => w.code)), new Set(['IMAGE_UNAVAILABLE', 'MERMAID_NOT_RENDERED']));
    let saved = false;
    h.ctx.attachments.saveFile = async () => { saved = true; throw new Error('unexpected save'); };
    const strict = await h.call({ ...args, strict: true });
    assert.equal(strict.isError, true);
    assert.equal(code(strict), 'CONTENT_INCOMPLETE', JSON.stringify(strict));
    assert.equal(saved, false);
  } finally { await h.close(); }
});
test('schema rejects mutually incompatible sources and errors retain codes', async () => {
  const h = await harness();
  try {
    for (const args of [{ source: { kind: 'file', path: 'x.md', text: 'x' } }, { source: { kind: 'markdown' } }, { source: { kind: 'other' } }]) assert.equal((await h.call(args)).isError, true);
    for (const [args, expected] of [[source('  '), 'EMPTY_INPUT'], [{ ...source('x'), fileName: '../x.docx' }, 'INVALID_INPUT'], [{ source: { kind: 'file', path: 'missing.md' } }, 'FS_NOT_FOUND']]) {
      const result = await h.call(args);
      assert.equal(result.isError, true);
      assert.equal(code(result), expected, JSON.stringify(result));
    }
  } finally { await h.close(); }
});
test('traversal and symlink images never read outside the image base', async () => {
  const h = await harness();
  try {
    await mkdir(path.join(h.root, 'docs'));
    await writeFile(path.join(h.root, 'secret.png'), Buffer.from('secret'));
    await symlink(h.root, path.join(h.root, 'docs', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = await h.call({ source: { kind: 'markdown', assetBaseDir: 'docs', text: '![a](../secret.png) ![b](linked/secret.png) ![c](https://example.com/a.png) ![d](file:///secret.png)' } });
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.equal(result.value.warnings.length, 4);
    assert.ok(result.value.warnings.every(w => w.code === 'IMAGE_UNAVAILABLE'));
    const outside = await h.call({ source: { kind: 'file', path: '../outside.md' } });
    assert.equal(code(outside), 'FS_SANDBOX_DENIED');
  } finally { await h.close(); }
});
