import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../lib/runtime/cli-client.js';
import { resolveConfig } from '../lib/config.js';
const config = resolveConfig({ workspaceRoot: '/workspace', cliCommand: 'bruce-md2word' });
const args = { source: { kind: 'markdown', text: '$(do-not-run)' } };
const success = { protocol: 1, path: '/workspace/output/document.docx', fileName: 'document.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: 100, warnings: [] };
const runResult = value => ({ exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 1000, stdout: { text: JSON.stringify(value), truncated: false }, stderr: { text: '', truncated: false } });

test('CLI adapter passes session cwd, policy and signal without interpolating model data', async () => {
  const signal = new AbortController().signal;
  const session = { header: { cwd: '/remote/project' } };
  const policy = { mode: 'workspace-write', workspaceRoot: '/remote/project' };
  let spec;
  const shell = { sandboxMode: 'workspace-write', resolve: x => x, run: async x => { spec = x; return runResult(success); } };
  const ctx = { get: name => name === 'shell' ? shell : { resolve: request => { assert.equal(request.session, session); return policy; } } };
  await runCli(ctx, args, { agent: { session } }, config, signal);
  assert.equal(spec.workdir, session.header.cwd);
  assert.equal(spec.sandboxPolicy, policy);
  assert.equal(spec.signal, signal);
  assert.equal(spec.command, 'bruce-md2word --request');
  assert.equal(JSON.parse(spec.stdin).input.source.text, args.source.text);
});

test('CLI adapter rejects sandbox denials, absent policy, timeout, truncation and malformed success', async () => {
  for (const [result, code] of [
    [{ ...runResult(success), sandbox: { denied: true, mode: 'read-only' } }, 'FS_SANDBOX_DENIED'],
    [{ ...runResult(success), timedOut: true }, 'LIMIT_EXCEEDED'],
    [{ ...runResult(success), stdout: { text: '', truncated: true } }, 'LIMIT_EXCEEDED'],
    [runResult({ ...success, sizeBytes: -1 }), 'CONVERSION_FAILED'],
  ]) {
    let calls = 0;
    const ctx = { get: name => name === 'shell' ? { resolve: x => x, run: async () => { calls++; return result; } } : undefined };
    await assert.rejects(runCli(ctx, args, {}, config, new AbortController().signal), { code });
    assert.equal(calls, 1);
  }
  const ctx = { get: name => name === 'shell' ? { sandboxMode: 'read-only' } : undefined };
  await assert.rejects(runCli(ctx, args, {}, config, new AbortController().signal), { code: 'CONFIGURATION_ERROR' });
});

test('CLI errors survive Node warning lines and require a versioned envelope', async () => {
  const warning = '(node:29086) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.\n(Use `node --trace-warnings ...` to show where the warning was created)\n';
  const envelope = { protocol: 1, error: { code: 'CONTENT_INCOMPLETE', message: 'Strict export rejected incomplete content.' } };
  for (const stderr of [JSON.stringify(envelope), warning + JSON.stringify(envelope) + '\n', JSON.stringify(envelope) + '\n' + warning]) {
    const ctx = { get: name => name === 'shell' ? { resolve: x => x, run: async () => ({ ...runResult(success), exitCode: 1, stderr: { text: stderr, truncated: false } }) } : undefined };
    await assert.rejects(runCli(ctx, args, {}, config, new AbortController().signal), { code: 'CONTENT_INCOMPLETE', message: envelope.error.message });
  }
  for (const stderr of [warning, JSON.stringify({ error: envelope.error }), JSON.stringify({ ...envelope, protocol: 2 })]) {
    const ctx = { get: name => name === 'shell' ? { resolve: x => x, run: async () => ({ ...runResult(success), exitCode: 1, stderr: { text: stderr, truncated: false } }) } : undefined };
    await assert.rejects(runCli(ctx, args, {}, config, new AbortController().signal), { code: 'CONVERSION_FAILED', message: 'CLI exited without a valid error response (exit code: 1).' });
  }
});
