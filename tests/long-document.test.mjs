import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import { parseMarkdown } from '../lib/core/markdown.js';
import { convert } from '../lib/core/convert.js';
import { defaults } from '../lib/config.js';
import { validateArtifact } from '../lib/runtime/artifact.js';
import { documentDefaults, parseDocumentOptions } from '../lib/core/document-options.js';
import { harness } from './harness.mjs';

async function build(source) {
  const result = await convert(parseMarkdown(source, defaults), [], [], defaults);
  await validateArtifact(result.data, defaults.maxOutputBytes);
  const zip = await JSZip.loadAsync(result.data);
  return { ...result, zip, xml: await zip.file('word/document.xml').async('string') };
}
const config = values => `<!-- word:document ${JSON.stringify(values)} -->\n\n`;
test('presets merge bounded overrides without mutable shared state', () => {
  assert.equal(parseDocumentOptions('{"preset":"technical"}').firstLineIndent, 0);
  assert.equal(parseDocumentOptions('{"margins":{"left":30}}').margins.right, 25);
  assert.equal(documentDefaults().margins.left, 25);
  for (const value of ['[]', 'null', '{"preset":"unknown"}', '{"preset":["technical"]}', '{"toc":"yes"}', '{"fontSize":0}', '{"tocDepth":1.5}', '{"margins":{"left":60}}', '{"margins":{"other":20}}', '{"unknown":1}', '{"font":""}']) assert.throws(() => parseDocumentOptions(value), value);
});
test('configured styles, TOC, title, header and footer fields survive OPC validation', async () => {
  const result = await build(config({ preset: 'technical', font: 'Arial', fontSize: 14, firstLineIndent: 1, lineSpacing: 2, margins: { left: 30 }, title: 'A & B', header: 'Header', footer: 'Internal', pageNumbers: true, toc: true, tocDepth: 2 }) + '# One\n\nBody.\n\n## Two');
  assert.deepEqual(result.warnings, []);
  assert.match(result.xml, /TOC .*1-2/);
  assert.match(result.xml, /A &amp; B/);
  assert.match(result.xml, /w:left="1701"/);
  const styles = await result.zip.file('word/styles.xml').async('string');
  assert.match(styles, /w:ascii="Arial"/);
  assert.match(styles, /w:firstLine="280"/);
  assert.match(styles, /w:line="480"/);
  const footer = await result.zip.file('word/footer1.xml').async('string');
  assert.match(footer, /PAGE/); assert.match(footer, /NUMPAGES/); assert.match(footer, /Internal/);
  assert.match(await result.zip.file('word/header1.xml').async('string'), /Header/);
  const plain = await build('# Plain');
  assert.doesNotMatch(plain.xml, /TOC |headerReference|footerReference/);
  const narrow = await build(config({ margins: { top: 10, bottom: 10 }, fontSize: 24, header: 'Header', pageNumbers: true }) + '# Title');
  assert.match(narrow.xml, /w:header="283"/);
  assert.match(narrow.xml, /w:footer="283"/);
  assert.match(await narrow.zip.file('word/header1.xml').async('string'), /w:sz w:val="20"/);
});
test('invalid, duplicate, nested and late configurations retain source and degrade', async () => {
  for (const source of [config({ unknown: true }), '# Heading\n\n' + config({ toc: true }), '> ' + config({ toc: true }), config({ toc: false }) + config({ toc: true })]) {
    const result = await build(source + '\nBody');
    assert.ok(result.warnings.some(w => w.code === 'LAYOUT_DIRECTIVE_INVALID'));
    assert.match(result.xml, /word:document/);
    assert.doesNotMatch(result.xml, /TOC /);
  }
  const code = await build('```md\n' + config({ toc: true }) + '```');
  assert.deepEqual(code.warnings, []); assert.doesNotMatch(code.xml, /TOC /);
});
test('landscape uses the wider table grid and restores portrait without restarting page numbers', async () => {
  const table = '| A | B |\n| - | - |\n| 1 | 2 |\n\n';
  const result = await build(config({ pageNumbers: true }) + table + '<!-- word:section landscape -->\n\n' + table + '<!-- word:section portrait -->\n\n' + table);
  const dom = new JSDOM(result.xml, { contentType: 'text/xml' });
  try {
    const doc = dom.window.document;
    assert.deepEqual([...doc.getElementsByTagName('w:pgSz')].map(n => n.getAttribute('w:w')), ['11906', '16838', '11906']);
    assert.deepEqual([...doc.getElementsByTagName('w:tblW')].map(n => n.getAttribute('w:w')), ['9072', '14004', '9072']);
    assert.ok([...doc.getElementsByTagName('w:pgNumType')].every(n => !n.hasAttribute('w:start')));
  } finally { dom.window.close(); }
  assert.deepEqual(result.warnings, []);
});
test('front matter stays portrait before landscape body without redundant page breaks', async () => {
  for (const front of [{ title: 'Report', toc: true }, { title: 'Report' }, { toc: true }, {}]) {
    const hasFront = !!(front.title || front.toc);
    const result = await build(config({ ...front, pageNumbers: true, header: 'Header' }) + '<!-- word:section landscape -->\n\n# Wide body\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<!-- word:section portrait -->\n\n# Portrait body');
    const dom = new JSDOM(result.xml, { contentType: 'text/xml' });
    try {
      const doc = dom.window.document;
      assert.deepEqual([...doc.getElementsByTagName('w:pgSz')].map(n => n.getAttribute('w:w')), hasFront ? ['11906', '16838', '11906'] : ['16838', '11906']);
      assert.equal(doc.getElementsByTagName('w:pageBreakBefore').length, 0, 'section break alone starts the body page');
      assert.ok([...doc.getElementsByTagName('w:pgNumType')].every(n => !n.hasAttribute('w:start')));
      const boundary = result.xml.indexOf('</w:sectPr>');
      if (front.title) assert.ok(result.xml.indexOf('Report</w:t>') < boundary);
      if (front.toc) assert.ok(result.xml.indexOf('TOC ') < boundary);
      if (hasFront) assert.ok(result.xml.indexOf('Wide body</w:t>') > boundary);
      assert.equal(doc.getElementsByTagName('w:headerReference').length, hasFront ? 3 : 2);
      assert.equal(doc.getElementsByTagName('w:footerReference').length, hasFront ? 3 : 2);
      assert.deepEqual(result.warnings, []);
    } finally { dom.window.close(); }
  }
  const portrait = await build(config({ title: 'Report', toc: true }) + '# Portrait body');
  assert.equal((portrait.xml.match(/<w:sectPr>/g) ?? []).length, 1);
  assert.equal((portrait.xml.match(/<w:pageBreakBefore\/>/g) ?? []).length, 1);
});

test('heading numbers are native and independent; caption SEQ and REF have cached results', async () => {
  const result = await build(config({ headingNumbering: true }) + '# One\n\n1. List\n\n## Sub\n\n见[表号](#ref:results)。\n\n<!-- word:caption kind=table id=results -->\n\nResults\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n# Two');
  assert.deepEqual(result.warnings, []);
  assert.match(result.xml, /SEQ Table/); assert.match(result.xml, /REF caption_1/);
  assert.match(result.xml, /表 1/);
  const dom = new JSDOM(result.xml, { contentType: 'text/xml' });
  try {
    const ids = [...dom.window.document.getElementsByTagName('w:numId')].map(n => n.getAttribute('w:val'));
    assert.equal(ids[0], ids[2]); assert.equal(ids[0], ids[3]); assert.notEqual(ids[0], ids[1]);
  } finally { dom.window.close(); }
  const invalid = await build('见[缺失](#ref:missing)\n\n<!-- word:caption kind=figure id=a -->\n\nWrong kind\n\n| A |\n| - |\n| 1 |');
  assert.deepEqual(new Set(invalid.warnings.map(w => w.code)), new Set(['LAYOUT_DIRECTIVE_INVALID', 'LINK_UNAVAILABLE']));
  assert.doesNotMatch(invalid.xml, /SEQ /);
});

test('DSH worker carries document options and strict invalid configuration saves no attachment', async () => {
  const h = await harness();
  try {
    const result = await h.call({ source: { kind: 'markdown', text: config({ preset: 'technical', toc: true, pageNumbers: true }) + '# Heading' }, strict: true });
    assert.equal(result.isError, false);
    const zip = await JSZip.loadAsync(await h.bytes(result.value.attachment));
    assert.match(await zip.file('word/document.xml').async('string'), /TOC /);
    assert.match(await zip.file('word/footer1.xml').async('string'), /NUMPAGES/);
    let saved = false;
    h.ctx.attachments.saveFile = async () => { saved = true; throw new Error('Unexpected save'); };
    const bad = await h.call({ source: { kind: 'markdown', text: config({ fontSize: 100 }) + '# Heading' }, strict: true });
    assert.equal(bad.error.info.code, 'CONTENT_INCOMPLETE');
    assert.match(JSON.stringify(bad.content), /LAYOUT_DIRECTIVE_INVALID/);
    assert.equal(saved, false);
  } finally { await h.close(); }
});
