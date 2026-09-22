/** Install only the tarball and published DSH packages outside this checkout. */
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const root = process.cwd();
// npm run supplies the actual npm JS entry point on every OS, avoiding .cmd
// shims and shell quoting on Windows (including paths containing spaces).
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this check with npm run test:pack');
const npm = (args, options) => execFileSync(process.execPath, [npmCli, ...args], options);
const temp = await mkdtemp(path.join(os.tmpdir(), 'md2word-pack-'));
let tarball;
try {
  const manifest = JSON.parse(npm(['pack', '--json'], { encoding: 'utf8', cwd: root }));
  tarball = path.join(root, manifest[0].filename);
  await writeFile(path.join(temp, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball, '@deepseek-ai/dsh-fs-local@0.1.6-alpha.2', '@deepseek-ai/dsh-attachment-local@0.1.6-alpha.2', '@deepseek-ai/dsh-subprocess-local@0.1.6-alpha.2', `@deepseek-ai/dsh-${process.platform === 'win32' ? 'pwsh' : 'bash'}-local@0.1.6-alpha.2`], { cwd: temp, stdio: 'inherit' });
  await writeFile(path.join(temp, 'smoke.mjs'), `
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local';
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local';
import LocalShell from '@deepseek-ai/dsh-${process.platform === 'win32' ? 'pwsh' : 'bash'}-local';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import * as plugin from 'dsh-md2word';
const ctx = new Context();
try {
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime);
  await ctx.plugin(LocalFileSystem, { cwd: process.cwd() });
  await ctx.plugin(LocalAttachmentStore, { dshHome: process.cwd() + '/home' });
  const fiber = ctx.plugin(plugin, { workspaceRoot: process.cwd(), delivery: 'attachment' }); await fiber;
  const result = await ctx.tools.execute({ callId: 'packed-export', name: 'word_export', arguments: { source: { kind: 'markdown', text: '# Isolated package\\n\\nWorker runs outside the source checkout.' } }, signal: new AbortController().signal });
  assert.equal(result.isError, false, JSON.stringify(result));
  let size = 0; for await (const chunk of ctx.attachments.readFileStream(result.value.attachment)) size += chunk.byteLength;
  assert.equal(size, result.value.sizeBytes);
  await fiber.dispose(); assert.equal(ctx.tools.get('word_export'), undefined);
  console.log('Packed worker + DSH attachment round-trip passed on ' + process.version);
  await ctx.plugin(LocalSubprocess); await ctx.plugin(LocalShell, { cwd: process.cwd() });
  const local = ctx.plugin(plugin, { workspaceRoot: process.cwd() }); await local;
  const exported = await ctx.tools.execute({ callId: 'packed-local-export', name: 'word_export', arguments: { source: { kind: 'markdown', text: '# Packaged default plugin $x_i^2$' } }, signal: new AbortController().signal });
  assert.equal(exported.isError, false, JSON.stringify(exported));
  const bytes = await readFile(exported.value.path);
  assert.equal(bytes.length, exported.value.sizeBytes);
  const zip = await JSZip.loadAsync(bytes);
  assert.match(await zip.file('word/document.xml').async('string'), /Packaged default plugin/);
  assert.match(await zip.file('word/document.xml').async('string'), /<m:sSubSup>/);
  await local.dispose(); assert.equal(ctx.tools.get('word_export'), undefined);
  console.log('Packed plugin launched its bundled CLI and delivered a project DOCX on ' + process.version);
} finally { await ctx.fiber.dispose(); }
`);
  execFileSync(process.execPath, [path.join(temp, 'smoke.mjs')], { cwd: temp, stdio: 'inherit' });
  const cli = path.join(temp, 'node_modules', 'dsh-md2word', 'lib', 'cli.js');
  const result = JSON.parse(execFileSync(process.execPath, [cli, '-', '-o', 'packed.docx'], { cwd: temp, input: '# Packed CLI\n\n中文与 **bold** $x_i^2$\n\n~~~mermaid\ngraph TD\nA[中文请求]-->B[完成]\n~~~', encoding: 'utf8' }));
  if (result.protocol !== 1 || result.fileName !== 'packed.docx' || result.sizeBytes <= 0 || result.warnings.length) throw new Error('Invalid packaged CLI result');
  const { default: JSZip } = await import('jszip');
  const { readFile } = await import('node:fs/promises');
  const packedZip = await JSZip.loadAsync(await readFile(result.path));
  if (!(await packedZip.file('word/document.xml').async('string')).includes('<w:drawing>')) throw new Error('Packaged Mermaid image missing');
  if (!(await packedZip.file('word/document.xml').async('string')).includes('<m:sSubSup>')) throw new Error('Packaged native equation missing');
  console.log('Packed CLI exported ' + result.fileName + ' on ' + process.version);
} finally {
  await rm(temp, { recursive: true, force: true });
  if (tarball) await rm(tarball, { force: true });
}
