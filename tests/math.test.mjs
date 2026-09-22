import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import { defaults } from '../lib/config.js';
import { parseMarkdown } from '../lib/core/markdown.js';
import { convert } from '../lib/core/convert.js';
import { validateArtifact } from '../lib/runtime/artifact.js';
import { harness } from './harness.mjs';
const ns = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
async function exported(markdown, limits = defaults) {
  const parsed = parseMarkdown(markdown, limits);
  const result = await convert(parsed, [], [], limits);
  await validateArtifact(result.data, limits.maxOutputBytes);
  const zip = await JSZip.loadAsync(result.data);
  const xml = await zip.file('word/document.xml').async('string');
  const dom = new JSDOM(xml, { contentType: 'text/xml' });
  try {
    const document = dom.window.document;
    const nodes = tag => Array.from(document.getElementsByTagNameNS(ns, tag));
    return { ...result, parsed, xml, count: tag => nodes(tag).length, text: tag => nodes(tag).map(n => n.textContent), values: tag => nodes(tag).map(n => n.getAttributeNS(ns, 'val')) };
  } finally { dom.window.close(); }
}

test('math delimiters protect TeX from Markdown; code, currency, escaped markers and URLs stay literal', async () => {
  const source = String.raw`# Formula $x_i^2$

价格 $5 和 $10；转义 \$x\$；普通正文。

行内 \(\frac{a}{b}\) 与 $2$。

${'`$x^2$`'}

~~~tex
$$\frac{a}{b}$$
~~~

    $code$

[link](https://example.com/$path$)

$$
\sqrt[3]{x}
$$

\[
\alpha+\beta
\]
`;
  const parsed = parseMarkdown(source, defaults);
  assert.equal(parsed.formulas.length, 5);
  assert.ok(parsed.html.includes('$x^2$'));
  assert.ok(parsed.html.includes('$5 和 $10'));
  assert.equal(parsed.formulas[0].line, 1);
  assert.equal(parsed.formulas[1].line, 5);
  assert.ok(!parsed.html.includes('<em>'));
  const result = await exported(source);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.count('oMath'), 5);
});

test('native equations preserve fractions, radicals, joint scripts, accents, bars and n-ary operators', async () => {
  const result = await exported(String.raw`$$
\frac{a}{b}+\sqrt{x}+\sqrt[3]{y}+x_i^2+\vec{v}+\hat{x}+\overline{AB}+\underline{c}+\sum_{i=1}^{n}i+\int_0^1 x dx
$$`);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.count('f'), 1);
  assert.equal(result.count('rad'), 2);
  assert.equal(result.count('sSubSup'), 1);
  assert.deepEqual(result.values('chr'), ['→', 'ˆ', '∑', '∫']);
  assert.equal(result.count('acc'), 2);
  assert.equal(result.count('bar'), 2);
  assert.equal(result.count('nary'), 2);
  assert.equal(result.count('oMathPara'), 1);
  assert.ok(!result.xml.includes('<w:drawing>'));
});

test('matrix cells, cases and aligned equations retain rows, columns, brackets and Chinese conditions', async () => {
  const result = await exported(String.raw`$$\begin{bmatrix}a&b\\c&d\end{bmatrix}$$

$$f(x)=\begin{cases}x^2 & \text{当 }x>0\\0 & x\le0\end{cases}$$

$$\begin{aligned}a&=b+c\\d&=e\end{aligned}$$`);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.count('m'), 3);
  assert.equal(result.count('mr'), 6);
  assert.ok(result.text('t').join('').includes('当'));
  assert.ok(result.values('begChr').includes('['));
  assert.ok(result.values('begChr').includes('{'));
  assert.ok(result.values('endChr').includes(''));
  assert.ok(result.values('mcJc').includes('right'));
  assert.ok(result.values('mcJc').includes('left'));
});

test('formulas work inside emphasis, links, lists, quotes and tables with source lines', async () => {
  const result = await exported(String.raw`**粗体 $x^2$** [公式 $y_i$](https://example.com)

- 公式 $\frac{1}{2}$

  $$a+b$$

> 公式 \(\sqrt{x}\)

| 说明 | 公式 |
| --- | --- |
| 行内 | $a+b$ |

第二行
失败 $\unknown{x}$`);
  assert.equal(result.count('oMath'), 6);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, 'MATH_NOT_CONVERTED');
  assert.equal(result.warnings[0].line, 14);
  assert.ok(result.xml.includes('\\unknown{x}'));
});

test('invalid or unsupported formulas preserve complete source and never report success', async () => {
  for (const source of [String.raw`\frac{a}`, String.raw`\unknown{x}`, String.raw`\label{hidden}x`, String.raw`\phantom{x}`, String.raw`\textbf{中文}`, String.raw`\color{red}x`, String.raw`\begin{array}{c|c}a&b\end{array}`, String.raw`\def\x{\x}\x`]) {
    const result = await exported(`$$${source}$$`);
    assert.equal(result.count('oMath'), 0, source);
    assert.equal(result.warnings[0]?.code, 'MATH_NOT_CONVERTED', source);
    assert.equal(result.warnings[0]?.line, 1);
    assert.ok(result.xml.includes('公式未转换'));
    assert.ok(!JSON.stringify(result.warnings).includes(source));
  }
  const unclosed = await exported('before\n\n$$\nx+1');
  assert.equal(unclosed.warnings[0].line, 3);
  assert.ok(unclosed.xml.includes('x+1'));
});

test('formula budgets and bounded diagnostics preserve degradation', async () => {
  assert.throws(() => parseMarkdown(Array(1001).fill('$x$').join(' '), defaults), { code: 'LIMIT_EXCEEDED' });
  const large = await exported('$$' + 'x'.repeat(50_001) + '$$');
  assert.equal(large.warnings[0].code, 'MATH_NOT_CONVERTED');
  const many = await exported(Array(4).fill('$\\bad{x}$').join('\n\n'), { ...defaults, maxDiagnostics: 2 });
  assert.equal(many.warnings.length, 2);
  assert.equal(many.warnings[1].severity, 'degradation');
});

test('common fraction styles and math text preserve content; image alt math stays literal', async () => {
  const result = await exported(String.raw`$\dfrac{a}{b}+\tfrac{c}{d}+\text{中文}+\mathbf{x}+\mathit{y}$`);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.count('f'), 2);
  assert.ok(result.text('t').join('').includes('中文'));
  assert.ok(result.text('t').join('').includes('𝐱'));
  assert.ok(result.text('t').join('').includes('y'));
  assert.equal(result.count('oMathPara'), 0);
  const parsed = parseMarkdown('![公式 $x_i$ 与 \\(y^2\\)](missing.png)', defaults);
  assert.equal(parsed.formulas.length, 0);
  assert.ok(parsed.html.includes('$x_i$'));
  assert.ok(parsed.html.includes('\\(y^2\\)'));
});

test('full positive fixture converts without degradation, currency next to code stays literal', async () => {
  const source = await readFile(new URL('../fixtures/数学公式.md', import.meta.url), 'utf8');
  const result = await exported(source);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.count('oMath'), 28);
  assert.ok(result.xml.includes('DSH-MATH-END'));
  const currency = parseMarkdown('金额 $5 和 $10；转义 \\$x\\$；行内代码 `$x^2$`。', defaults);
  assert.equal(currency.formulas.length, 0);
});

test('DSH attachment worker returns native equations and strict math degradation saves no attachment', async () => {
  const h = await harness();
  try {
    const good = await h.call({ source: { kind: 'markdown', text: '$x_i^2$' }, strict: true });
    assert.equal(good.isError, false, JSON.stringify(good));
    const zip = await JSZip.loadAsync(await h.bytes(good.value.attachment));
    assert.match(await zip.file('word/document.xml').async('string'), /<m:sSubSup>/);
    const bad = await h.call({ source: { kind: 'markdown', text: '$\\unknown{x}$' }, strict: true });
    assert.equal(bad.isError, true);
    assert.match(JSON.stringify(bad), /CONTENT_INCOMPLETE|Strict export rejected/);
  } finally { await h.close(); }
});

test('CLI strict equations save editable math, reject degradation and never publish failed output', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'md2word-math-'));
  const cli = fileURLToPath(new URL('../lib/cli.js', import.meta.url));
  const call = (name, source, strict = true) => spawnSync(process.execPath, [cli, '-', '-o', name, ...(strict ? ['--strict'] : [])], { cwd: root, input: source, encoding: 'utf8', timeout: 30_000 });
  try {
    const good = call('good.docx', '$\\frac{1}{2}$');
    assert.equal(good.status, 0, good.stderr);
    assert.deepEqual(JSON.parse(good.stdout).warnings, []);
    const zip = await JSZip.loadAsync(await readFile(path.join(root, 'good.docx')));
    assert.match(await zip.file('word/document.xml').async('string'), /<m:f>/);
    const bad = call('bad.docx', '$\\unknown{x}$');
    assert.equal(bad.status, 1);
    assert.equal(JSON.parse(bad.stderr).error.code, 'CONTENT_INCOMPLETE');
    assert.deepEqual(await readdir(root), ['good.docx']);
    const fallback = call('fallback.docx', '$\\unknown{x}$', false);
    assert.equal(fallback.status, 0, fallback.stderr);
    assert.equal(JSON.parse(fallback.stdout).warnings[0].code, 'MATH_NOT_CONVERTED');
  } finally { await rm(root, { recursive: true, force: true }); }
});
