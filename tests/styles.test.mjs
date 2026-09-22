import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Document, Packer } from 'docx';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import { createStyles, createMargins, createNumbering, numberingLevels, PAGE_WIDTH, PAGE_HEIGHT } from '../lib/core/styles.js';
import { convertHTMLToDocx } from '../lib/core/html-to-docx.js';
import { Diagnostics } from '../lib/core/diagnostics.js';

const reference = JSON.parse(await readFile(new URL('../fixtures/reference/bruce-styles.json', import.meta.url), 'utf8'));
async function build(html = reference.html, images = new Map()) {
  const converted = convertHTMLToDocx(html, images, new Diagnostics(100));
  const doc = new Document({ styles: createStyles(), numbering: converted.numbering, sections: [{ properties: { page: { size: { width: PAGE_WIDTH, height: PAGE_HEIGHT }, margin: createMargins() } }, children: converted.children }] });
  return JSZip.loadAsync(await Packer.toBuffer(doc));
}
const elements = (doc, name) => Array.from(doc.getElementsByTagName(`w:${name}`));
test('all style definitions and five-level numbering retain the pinned Bruce defaults', () => {
  const styles = createStyles();
  assert.equal(styles.default.document.paragraph.indent.firstLine, 0);
  assert.equal(styles.paragraphStyles.find(s => s.id === 'BodyText').paragraph.indent.firstLine, 480);
  const legacy = structuredClone(styles);
  legacy.default.document.paragraph.indent.firstLine = 480;
  legacy.paragraphStyles = legacy.paragraphStyles.filter(s => !['BodyText', 'Caption', 'FootnoteText'].includes(s.id));
  assert.deepEqual(legacy, reference.styles);
  assert.deepEqual(createNumbering(), reference.numbering);
  for (const [index, ordered] of [false, true].entries()) {
    assert.deepEqual(numberingLevels(ordered, 3), reference.numbering.config[index].levels.map(level => ({ ...level, start: 3 })));
  }
});

test('fonts, inline formatting, borders and cell styling retain the reference defaults', async () => {
  const zip = await build();

  const expected = new JSDOM(await readFile(new URL('../fixtures/reference/document.xml', import.meta.url), 'utf8'), { contentType: 'text/xml' });
  const actual = new JSDOM(await zip.file('word/document.xml').async('string'), { contentType: 'text/xml' });
  try {
    // docx allocates random relationship IDs; they carry no visual formatting.
    for (const dom of [actual, expected]) for (const link of elements(dom.window.document, 'hyperlink')) link.setAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'r:id', 'reference-link');
    const expectedParagraphs = elements(expected.window.document, 'p');
    const actualParagraphs = elements(actual.window.document, 'p');
    assert.equal(actualParagraphs.length, expectedParagraphs.length);
    actualParagraphs.forEach((paragraph, i) => assert.deepEqual(elements(paragraph, 'r').map(r => r.outerHTML), elements(expectedParagraphs[i], 'r').map(r => r.outerHTML), `paragraph runs ${i}`));
    for (const property of ['tblBorders', 'tcMar', 'vAlign', 'shd', 'tblHeader', 'pgMar']) {
      assert.deepEqual(elements(actual.window.document, property).map(node => node.outerHTML), elements(expected.window.document, property).map(node => node.outerHTML), property);
    }
  } finally { actual.window.close(); expected.window.close(); }
});

test('small images retain natural dimensions and block spacing', async () => {
  const data = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6N6t0AAAAASUVORK5CYII=', 'base64');
  const zip = await build('<img src="sample" alt="样图"/>', new Map([['sample', { data, type: 'png', width: 1, height: 1 }]]));
  const dom = new JSDOM(await zip.file('word/document.xml').async('string'), { contentType: 'text/xml' });
  try {
    const doc = dom.window.document;
    const extent = doc.getElementsByTagName('wp:extent')[0];
    assert.equal(extent.getAttribute('cx'), String(9525));
    assert.equal(extent.getAttribute('cy'), String(9525));
    assert.equal(elements(doc, 'jc')[0].getAttribute('w:val'), 'center');
    const spacing = elements(doc, 'spacing')[0];
    assert.equal(spacing.getAttribute('w:before'), '200');
    assert.equal(spacing.getAttribute('w:after'), '200');
  } finally { dom.window.close(); }
});
