import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import { parseMarkdown } from '../lib/core/markdown.js';
import { convert } from '../lib/core/convert.js';
import { defaults } from '../lib/config.js';
import { validateArtifact } from '../lib/runtime/artifact.js';
import { harness } from './harness.mjs';
async function build(markdown) {
  const result = await convert(parseMarkdown(markdown, defaults), [], [], defaults);
  await validateArtifact(result.data, defaults.maxOutputBytes);
  const zip = await JSZip.loadAsync(result.data);
  const dom = new JSDOM(await zip.file('word/document.xml').async('string'), { contentType: 'text/xml' });
  return { ...result, zip, dom, doc: dom.window.document };
}
const els = (node, name) => [...node.getElementsByTagName(`w:${name}`)];
const attr = (node, name) => node.getAttribute(`w:${name}`);
const text = p => els(p, 't').map(n => n.textContent).join('');
const paragraph = (doc, value) => els(doc, 'p').find(p => text(p) === value);
const num = (doc, value) => attr(els(paragraph(doc, value), 'numId')[0], 'val');

test('repeated footnote cached numbers skip degraded nested references', async () => {
  const result = await build('First[^a].\n\n[^a]: Nested[^b].\n\n[^b]: Nested body.\n\nActual[^c] and again[^c].\n\n[^c]: Actual body.');
  try {
    assert.equal(els(result.doc, 'footnoteReference').length, 2);
    assert.equal(text(els(result.doc, 'fldSimple')[0]), '2');
  } finally { result.dom.window.close(); }
});

test('adaptive table columns, explicit ratios and short/long row pagination', async () => {
  const result = await build('| ID | Description |\n| - | - |\n| 1 | A longer description with several words to explain the item. |\n\n<!-- word:table widths=1,3 -->\n\n| ID | Body |\n| - | - |\n| 2 | short |\n| 3 | ' + 'long description '.repeat(300) + ' |');
  try {
    const tables = els(result.doc, 'tbl');
    const widths = table => els(table, 'gridCol').map(n => Number(attr(n, 'w')));
    assert.ok(widths(tables[0])[1] > widths(tables[0])[0]);
    assert.deepEqual(widths(tables[1]), [2268, 6804]);
    for (const table of tables) {
      assert.equal(widths(table).reduce((a,b)=>a+b), 9072);
      assert.equal(attr(els(table, 'tblLayout')[0], 'type'), 'fixed');
      for (const row of els(table, 'tr')) assert.deepEqual(els(row, 'tcW').map(n=>Number(attr(n,'w'))), widths(table));
    }
    const rows = els(tables[1], 'tr');
    assert.equal(els(rows[0], 'tblHeader').length, 1);
    assert.notEqual(attr(els(rows[1], 'cantSplit')[0], 'val'), 'false');
    assert.equal(attr(els(rows[2], 'cantSplit')[0], 'val'), 'false');
    assert.deepEqual(result.warnings, []);
  } finally { result.dom.window.close(); }
});

test('headings, captions and short code keep together while long code can paginate', async () => {
  const result = await build('# Heading\n\nBody.\n\n```txt\nshort\ncode\n```\n\n```txt\n' + 'long code\n'.repeat(50) + '```\n\n<!-- word:caption -->\n\nTable title\n\n| A | B |\n| - | - |\n| 1 | 2 |');
  try {
    assert.equal(els(paragraph(result.doc, 'Heading'), 'keepNext').length, 1);
    assert.equal(els(paragraph(result.doc, 'Table title'), 'keepNext').length, 1);
    const codes = els(result.doc, 'p').filter(p => els(p, 'pStyle').some(s => attr(s, 'val') === 'CodeBlock'));
    assert.notEqual(attr(els(codes[0], 'keepLines')[0], 'val'), 'false');
    assert.equal(attr(els(codes[1], 'keepLines')[0], 'val'), 'false');
  } finally { result.dom.window.close(); }
});

test('named lists continue or restart explicitly without merging ordinary lists', async () => {
  const result = await build('<!-- word:list id=steps -->\n\n3. start\n4. next\n\n# Another chapter\n\n<!-- word:list id=steps continue -->\n\n1. continued\n\n<!-- word:list id=steps restart -->\n\n1. reset\n\nText.\n\n1. ordinary\n\nMore text.\n\n1. independent');
  try {
    assert.equal(num(result.doc, 'start'), num(result.doc, 'continued'));
    assert.notEqual(num(result.doc, 'continued'), num(result.doc, 'reset'));
    assert.notEqual(num(result.doc, 'ordinary'), num(result.doc, 'independent'));
    assert.deepEqual(result.warnings, []);
  } finally { result.dom.window.close(); }
});

test('section policy continues top-level lists within scope and resets at configured headings', async () => {
  const result = await build('<!-- word:numbering section=1 -->\n\n# A\n\n1. first\n\n## Subsection\n\n1. continued\n\n# B\n\n1. reset\n\nText\n\n7. explicit\n\nText\n\n1. after explicit\n\n<!-- word:numbering source -->\n\n1. source\n\nText\n\n1. new source');
  try {
    assert.equal(num(result.doc, 'first'), num(result.doc, 'continued'));
    assert.notEqual(num(result.doc, 'first'), num(result.doc, 'reset'));
    assert.notEqual(num(result.doc, 'reset'), num(result.doc, 'explicit'));
    assert.equal(num(result.doc, 'explicit'), num(result.doc, 'after explicit'));
    assert.notEqual(num(result.doc, 'source'), num(result.doc, 'new source'));
    assert.deepEqual(result.warnings, []);
  } finally { result.dom.window.close(); }
});

test('invalid directives and unavailable continuation report degradation, code stays literal', async () => {
  const result = await build('<!-- word:list id=unknown continue -->\n\n1. unmatched\n\n<!-- word:table widths=1,0 -->\n\n| A | B |\n| - | - |\n| x | y |\n\n```txt\n<!-- word:numbering section=1 -->\n```');
  try {
    assert.deepEqual(new Set(result.warnings.map(w=>w.code)), new Set(['LIST_CONTINUATION_UNAVAILABLE','LAYOUT_DIRECTIVE_INVALID']));
    assert.ok(els(result.doc,'t').some(t=>t.textContent.includes('word:table widths=1,0')));
    assert.ok(els(result.doc,'t').some(t=>t.textContent.includes('word:numbering section=1')));
  } finally { result.dom.window.close(); }
});

test('footnotes have one native definition, repeated NOTEREF field, formatting, formulas and external relationships', async () => {
  const result = await build('First[^a], repeat[^a].\n\n[^a]: **Bold** $x^2$ and [link](https://example.com).\n\n    Second paragraph.');
  try {
    assert.equal(els(result.doc,'footnoteReference').length, 1);
    assert.equal(els(result.doc,'fldSimple').length, 1);
    assert.match(attr(els(result.doc,'fldSimple')[0],'instr'), /NOTEREF note_1/);
    const xml = await result.zip.file('word/footnotes.xml').async('string');
    assert.match(xml, /Second paragraph/); assert.match(xml, /<w:b\/>/); assert.match(xml, /<m:sSup>/);
    assert.match(await result.zip.file('word/_rels/footnotes.xml.rels').async('string'), /https:\/\/example.com/);
    assert.deepEqual(result.warnings, []);
  } finally { result.dom.window.close(); }
});

test('undefined, unused, duplicate and nested notes preserve content with appropriate diagnostics', async () => {
  const result = await build('First[^a], missing[^missing].\n\n[^a]: Nested[^b].\n\n[^b]: Nested body.\n\n[^orphan]: Unused body.\n\n[^a]: Duplicate body.\n\n```txt\n[^code]: literal\n```');
  try {
    const body = els(result.doc,'t').map(t=>t.textContent).join(' ');
    for (const content of ['[^missing]', 'Unused body.', 'Duplicate body.', 'Nested body.', '[^code]: literal']) assert.ok(body.includes(content), content);
    const codes = new Set(result.warnings.map(w=>w.code));
    for (const code of ['FOOTNOTE_UNDEFINED','FOOTNOTE_UNUSED','FOOTNOTE_DUPLICATE','FOOTNOTE_NESTED']) assert.ok(codes.has(code),code);
    assert.equal(els(result.doc,'footnoteReference').length, 1);
  } finally { result.dom.window.close(); }
});

test('strict DSH export accepts native footnotes and rejects unresolved references before save', async () => {
  const h = await harness();
  try {
    const good = await h.call({source:{kind:'markdown',text:'Native[^n].\n\n[^n]: Footnote body.'},strict:true});
    assert.equal(good.isError, false, JSON.stringify(good));
    const zip = await JSZip.loadAsync(await h.bytes(good.value.attachment));
    assert.match(await zip.file('word/footnotes.xml').async('string'), /Footnote body/);
    let saved = false;
    h.ctx.attachments.saveFile = async () => { saved = true; throw Error('unexpected save'); };
    const bad = await h.call({source:{kind:'markdown',text:'Missing[^n].'},strict:true});
    assert.equal(bad.error.info.code,'CONTENT_INCOMPLETE');
    assert.match(JSON.stringify(bad.content), /FOOTNOTE_UNDEFINED/);
    assert.equal(saved,false);
  } finally { await h.close(); }
});

test('footnote code, nested definitions, tables and source lines never silently lose text', async () => {
  const result = await build('Text[^n].\n\n[^n]: Intro.\n\n    ```txt\n    [^code]: code stays literal\n    ```\n\n    [^nested]: nested definition preserved\n\n    | A | B |\n    | - | - |\n    | a | $x$ |\n\nMissing[^undefined].');
  try {
    const notes = await result.zip.file('word/footnotes.xml').async('string');
    assert.match(notes, /code stays literal/);
    assert.match(notes, /nested definition preserved/);
    assert.match(notes, /<m:oMath>/);
    assert.ok(result.warnings.some(w=>w.code==='FOOTNOTE_NESTED'));
    assert.ok(result.warnings.some(w=>w.code==='FOOTNOTE_TABLE_FLATTENED'));
    assert.equal(result.warnings.find(w=>w.code==='FOOTNOTE_UNDEFINED').line,15);
  } finally { result.dom.window.close(); }
});

test('footnote count is bounded and extreme table ratios fall back with a diagnostic', async () => {
  assert.throws(()=>parseMarkdown(Array.from({length:1001},(_,i)=>`[^n${i}]: body`).join('\n\n'),defaults),{code:'LIMIT_EXCEEDED'});
  const result=await build('<!-- word:table widths=0.000001,1000 -->\n\n| A | B |\n| - | - |\n| a | b |');
  try {
    assert.ok(result.warnings.some(w=>w.code==='LAYOUT_DIRECTIVE_INVALID'));
    assert.ok(els(result.doc,'gridCol').every(n=>Number(attr(n,'w'))>=480));
  } finally {result.dom.window.close();}
});

test('chapter list state does not leak into footnote lists', async () => {
  const result = await build('<!-- word:numbering section=1 -->\n\n# A\n\n3. body[^n]\n\n[^n]: Intro.\n\n    1. footnote item');
  try {
    const note = new JSDOM(await result.zip.file('word/footnotes.xml').async('string'),{contentType:'text/xml'});
    try { assert.notEqual(attr(els(result.doc,'numId')[0],'val'),attr(els(note.window.document,'numId')[0],'val')); }
    finally { note.window.close(); }
    assert.deepEqual(result.warnings,[]);
  } finally { result.dom.window.close(); }
});
