import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskQueue } from '../lib/runtime/queue.js';
import { runWorker } from '../lib/runtime/worker-client.js';
import { defaults } from '../lib/config.js';
import { harness } from './harness.mjs';
import { AttachmentError } from '@deepseek-ai/dsh-attachment';
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local';
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local';
import LocalPwsh from '@deepseek-ai/dsh-pwsh-local';
import LocalBash from '@deepseek-ai/dsh-bash-local';
import path from 'node:path';
const deferred = () => Promise.withResolvers();
const signal = () => new AbortController().signal;
const args = { source: { kind: 'markdown', text: '# Lifecycle' } };

test('project tool waits for shell, unloads with it and exports after service recovery without fs', async () => {
  const h = await harness({ delivery: 'project' }, undefined, { fs: false, attachments: false });
  try {
    assert.equal(h.ctx.tools.get('word_export'), undefined);
    assert.equal((await h.ctx.skills.list()).some(skill => skill.name === 'dsh-md2word'), false);
    await h.ctx.plugin(LocalSubprocess);
    const provider = process.platform === 'win32' ? LocalPwsh : LocalBash;
    for (let i = 0; i < 2; i++) {
      const shellFiber = h.ctx.plugin(provider, { cwd: h.root }); await shellFiber;
      assert.ok(h.ctx.tools.get('word_export'));
      assert.equal((await h.call(args)).isError, false);
      await shellFiber.dispose();
      assert.equal(h.ctx.tools.get('word_export'), undefined);
      assert.equal((await h.ctx.skills.list()).some(skill => skill.name === 'dsh-md2word'), false);
    }
  } finally { await h.close(); }
});

test('attachment service loss cancels active work and recovery creates a usable queue', async () => {
  const h = await harness({}, undefined, { attachments: false });
  try {
    assert.equal(h.ctx.tools.get('word_export'), undefined);
    const mount = () => h.ctx.plugin(LocalAttachmentStore, { dshHome: path.join(h.root, 'home') });
    const provider = mount(); await provider;
    assert.ok(h.ctx.tools.get('word_export'));
    const started = deferred();
    const resolve = h.ctx.fs.resolve.bind(h.ctx.fs);
    h.ctx.fs.resolve = async (_path, options) => {
      started.resolve();
      await new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    };
    const task = h.call(args);
    await started.promise;
    await provider.dispose();
    assert.equal((await task).isError, true);
    assert.equal(h.ctx.tools.get('word_export'), undefined);
    h.ctx.fs.resolve = resolve;
    const replacement = mount(); await replacement;
    const result = await h.call(args);
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.ok((await h.bytes(result.value.attachment)).length > 0);
  } finally { await h.close(); }
});
test('queue admits one task, rejects overflow, and cancellation removes a waiting slot', async () => {
  const queue = new TaskQueue(1, 1, 5000);
  const gate = deferred();
  const first = queue.run(signal(), () => gate.promise);
  const controller = new AbortController();
  let ran = false;
  const waiting = queue.run(controller.signal, async () => { ran = true; });
  await assert.rejects(queue.run(signal(), async () => {}), { code: 'BUSY' });
  controller.abort(new DOMException('Canceled', 'AbortError'));
  await assert.rejects(waiting, { name: 'AbortError' });
  assert.equal(ran, false);
  const next = queue.run(signal(), async () => 'next');
  gate.resolve('first');
  assert.equal(await first, 'first'); assert.equal(await next, 'next');
  await queue.dispose();
});
test('deadline includes queue time and pre-aborted calls do not consume capacity', async () => {
  const queue = new TaskQueue(1, 1, 40);
  const gate = deferred();
  const first = queue.run(signal(), () => gate.promise);
  const waiting = queue.run(signal(), async () => 'must not run');
  await assert.rejects(waiting, { code: 'LIMIT_EXCEEDED' });
  gate.resolve(); await first;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(queue.run(controller.signal, async () => {}), { name: 'AbortError' });
  assert.equal(await queue.run(signal(), async () => 'available'), 'available');
  await queue.dispose();
});
test('worker cancellation stops pending provider I/O and waits for cleanup', async () => {
  const controller = new AbortController();
  const started = deferred();
  let cleaned = false;
  const task = runWorker('![a](a.png)', defaults, controller.signal, async (_refs, ioSignal) => {
    started.resolve();
    try { await new Promise((_, reject) => ioSignal.addEventListener('abort', () => reject(ioSignal.reason), { once: true })); }
    finally { cleaned = true; }
  });
  await started.promise;
  controller.abort(new DOMException('Canceled', 'AbortError'));
  await assert.rejects(task, { name: 'AbortError' });
  assert.equal(cleaned, true);
});
test('plugin unload cancels active conversion, removes tool and guidance', async () => {
  const h = await harness();
  try {
    const started = deferred();
    h.ctx.fs.resolve = async (_path, options) => {
      started.resolve();
      await new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    };
    const task = h.call(args);
    await started.promise;
    await h.fiber.dispose();
    assert.equal((await task).isError, true);
    assert.equal(h.ctx.tools.get('word_export'), undefined);
    assert.equal((await h.ctx.skills.list()).some(skill => skill.name === 'dsh-md2word'), false);
  } finally { await h.close(); }
});
test('attachment errors are preserved; the target registry renders their message without metadata', async () => {
  const h = await harness();
  try {
    const error = new AttachmentError('Unsupported fixture provider', 'ATTACHMENT_FILES_UNSUPPORTED');
    h.ctx.attachments.saveFile = async () => { throw error; };
    await assert.rejects(h.ctx.tools.get('word_export').execute(args, { signal: signal() }), caught => caught === error);
    const result = await h.call(args);
    assert.equal(result.isError, true);
    assert.equal(result.error.message, error.message);
    assert.equal(result.error.info, undefined);
  } finally { await h.close(); }
});
test('cancellation racing with save hides success and preserves provider-owned committed bytes', async () => {
  const h = await harness();
  try {
    const controller = new AbortController();
    const save = h.ctx.attachments.saveFile.bind(h.ctx.attachments);
    let ref;
    h.ctx.attachments.saveFile = async input => {
      ref = await save(input);
      controller.abort(new DOMException('Cancel after commit', 'AbortError'));
      return ref;
    };
    const result = await h.call(args, controller.signal);
    assert.equal(result.isError, true);
    assert.equal(result.error?.info?.code, 'ABORTED', JSON.stringify(result));
    assert.equal(result.content.some(block => block.type === 'file'), false);
    assert.ok((await h.bytes(ref)).byteLength > 0);
  } finally { await h.close(); }
});
