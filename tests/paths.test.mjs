import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, mkdtemp, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { harness } from './harness.mjs';
import { readInput } from '../lib/runtime/paths.js';
import { resolveConfig } from '../lib/config.js';

test('session cwd takes priority over fallback and resolves relative files and asset directories', async () => {
  const h = await harness();
  try {
    const cwd = path.join(h.root, 'session');
    await mkdir(cwd);
    await writeFile(path.join(h.root, 'report.md'), 'fallback');
    await writeFile(path.join(cwd, 'report.md'), 'session');
    const exec = { agent: { session: { header: { cwd } } } };
    const config = resolveConfig({ workspaceRoot: h.root });
    const signal = new AbortController().signal;
    const result = await readInput(h.ctx.fs, { source: { kind: 'file', path: 'report.md' } }, exec, config, signal);
    assert.equal(result.markdown, 'session');
    assert.equal(result.assetBase, cwd);
    const text = await readInput(h.ctx.fs, { source: { kind: 'markdown', text: 'x', assetBaseDir: '.' } }, exec, config, signal);
    assert.equal(text.assetBase, cwd);
  } finally { await h.close(); }
});

test('source symlinks cannot escape roots; an administrator can explicitly allow another root', async () => {
  const h = await harness();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'md2word-outside-'));
  try {
    const file = path.join(outside, 'report.md');
    await writeFile(file, 'outside');
    await symlink(outside, path.join(h.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const signal = new AbortController().signal;
    await assert.rejects(readInput(h.ctx.fs, { source: { kind: 'file', path: 'linked/report.md' } }, {}, resolveConfig({ workspaceRoot: h.root }), signal), { code: 'FS_SANDBOX_DENIED' });
    const result = await readInput(h.ctx.fs, { source: { kind: 'file', path: file } }, {}, resolveConfig({ workspaceRoot: h.root, allowedReadRoots: [outside] }), signal);
    assert.equal(result.markdown, 'outside');
  } finally { await h.close(); await rm(outside, { recursive: true, force: true }); }
});

test('file symlinks cannot escape source or image roots', async t => {
  const h = await harness();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'md2word-file-link-'));
  try {
    await writeFile(path.join(outside, 'report.md'), 'outside');
    await writeFile(path.join(outside, 'secret.png'), 'not an image');
    try {
      await symlink(path.join(outside, 'report.md'), path.join(h.root, 'linked.md'), 'file');
    } catch (error) {
      if (process.platform !== 'win32' || error.code !== 'EPERM' || process.env.CI) throw error;
      t.skip('Windows file symlinks require Developer Mode or symlink privilege; junction checks still run. CI requires this test.');
      return;
    }
    await symlink(path.join(outside, 'secret.png'), path.join(h.root, 'linked.png'), 'file');
    await assert.rejects(readInput(h.ctx.fs, { source: { kind: 'file', path: 'linked.md' } }, {}, resolveConfig({ workspaceRoot: h.root }), new AbortController().signal), { code: 'FS_SANDBOX_DENIED' });
    let read = false;
    h.ctx.fs.readBytes = async () => { read = true; throw new Error('Outside image must not be read'); };
    const result = await h.call({ source: { kind: 'markdown', text: '![secret](linked.png)', assetBaseDir: '.' } });
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.equal(result.value.warnings[0].code, 'IMAGE_UNAVAILABLE');
    assert.equal(read, false);
  } finally { await h.close(); await rm(outside, { recursive: true, force: true }); }
});

test('actual read limits hold even when stat reports a smaller file', async () => {
  const h = await harness({ maxMarkdownBytes: 4 });
  try {
    await writeFile(path.join(h.root, 'growing.md'), '12345');
    const stat = h.ctx.fs.stat.bind(h.ctx.fs);
    h.ctx.fs.stat = async (...args) => {
      const info = await stat(...args);
      return info?.type === 'file' ? { ...info, size: 1 } : info;
    };
    const result = await h.call({ source: { kind: 'file', path: 'growing.md' } });
    assert.equal(result.isError, true);
    assert.equal(result.error.info.code, 'FS_TOO_LARGE');
  } finally { await h.close(); }
});
