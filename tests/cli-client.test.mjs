import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../lib/runtime/cli-client.js';
import { resolveConfig } from '../lib/config.js';
const config = resolveConfig({ workspaceRoot: '/workspace', cliCommand: 'bruce-md2word' });
const args = { source: { kind: 'markdown', text: '$(do-not-run)' } };
const success = { protocol: 1, path: '/workspace/output/document.docx', fileName: 'document.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: 100, warnings: [] };
const executeResult = read => async spec => ({ result: () => read(spec) });
const runResult = value => ({ exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 1000, stdout: { text: JSON.stringify(value), truncated: false }, stderr: { text: '', truncated: false } });

test('CLI adapter passes session cwd, policy and signal without interpolating model data', async () => {
  const signal = new AbortController().signal;
  const session = { header: { cwd: '/remote/project' } };
  const policy = { mode: 'workspace-write', workspaceRoot: '/remote/project' };
  let spec;
  const shell = { sandboxMode: 'workspace-write', resolve: x => x, execute: executeResult(async x => { spec = x; return runResult(success); }) };
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
    const ctx = { get: name => name === 'shell' ? { resolve: x => x, execute: executeResult(async () => { calls++; return result; }) } : undefined };
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
    const ctx = { get: name => name === 'shell' ? { resolve: x => x, execute: executeResult(async () => ({ ...runResult(success), exitCode: 1, stderr: { text: stderr, truncated: false } })) } : undefined };
    await assert.rejects(runCli(ctx, args, {}, config, new AbortController().signal), { code: 'CONTENT_INCOMPLETE', message: envelope.error.message });
  }
  for (const stderr of [warning, JSON.stringify({ error: envelope.error }), JSON.stringify({ ...envelope, protocol: 2 })]) {
    const ctx = { get: name => name === 'shell' ? { resolve: x => x, execute: executeResult(async () => ({ ...runResult(success), exitCode: 1, stderr: { text: stderr, truncated: false } })) } : undefined };
    await assert.rejects(runCli(ctx, args, {}, config, new AbortController().signal), { code: 'CONVERSION_FAILED', message: 'CLI exited without a valid error response (exit code: 1).' });
  }
});

test('strict error diagnostics survive CLI transport and malformed diagnostic payloads are rejected', async () => {
  const diagnostics = [{ code: 'IMAGE_UNAVAILABLE', severity: 'degradation', message: 'Missing image.', line: 2 }];
  const ctxFor = details => ({ get: name => name === 'shell' ? { resolve: x => x, execute: executeResult(async () => ({ ...runResult(success), exitCode: 1, stderr: { text: JSON.stringify({ protocol: 1, error: { code: 'CONTENT_INCOMPLETE', message: 'Incomplete', diagnostics: details } }), truncated: false } })) } : undefined });
  await assert.rejects(runCli(ctxFor(diagnostics), args, {}, config, new AbortController().signal), error => {
    assert.equal(error.code, 'CONTENT_INCOMPLETE');
    assert.deepEqual(error.diagnostics, diagnostics);
    assert.match(error.message, /IMAGE_UNAVAILABLE \(line 2\)/);
    return true;
  });
  for (const malformed of [[{ ...diagnostics[0], line: -1 }], [{ ...diagnostics[0], message: 'x'.repeat(301) }], Array(101).fill(diagnostics[0]), 'invalid']) {
    await assert.rejects(runCli(ctxFor(malformed), args, {}, config, new AbortController().signal), { code: 'CONVERSION_FAILED' });
  }
});

test('DSH 0.1.7 execution handle receives policy, stdin and a kill deadline', async () => {
  const signal = new AbortController().signal;
  const policy = { mode: 'workspace-write', workspaceRoot: '/workspace' };
  let executions = 0;
  let results = 0;
  const shell = {
    sandboxMode: 'workspace-write',
    resolve: spec => spec,
    async execute(spec) {
      executions++;
      assert.equal(spec.onExpiry, 'kill');
      assert.equal(spec.timeoutMs, config.timeoutMs);
      assert.equal(spec.signal, signal);
      assert.equal(spec.sandboxPolicy, policy);
      assert.equal(JSON.parse(spec.stdin).input.source.text, args.source.text);
      return { async result() { results++; return runResult(success); } };
    },
  };
  const ctx = { get: name => name === 'shell' ? shell : { resolve: () => policy } };
  assert.equal((await runCli(ctx, args, {}, config, signal)).path, success.path);
  assert.equal(executions, 1);
  assert.equal(results, 1);
});

test('DSH 0.1.7 propagates execution and result failures without retry', async () => {
  for (const phase of ['execute', 'result']) {
    const failure = new Error(`${phase} failed`);
    let executions = 0;
    const shell = {
      resolve: spec => spec,
      async execute() {
        executions++;
        if (phase === 'execute') throw failure;
        return { async result() { throw failure; } };
      },
    };
    const ctx = { get: name => name === 'shell' ? shell : undefined };
    await assert.rejects(runCli(ctx, args, {}, config, new AbortController().signal), error => error === failure);
    assert.equal(executions, 1);
  }
});

test('DSH 0.1.7 result preserves sandbox, timeout and cancellation errors', async () => {
  for (const [extra, expected] of [
    [{ sandbox: { denied: true } }, { code: 'FS_SANDBOX_DENIED' }],
    [{ sandbox: { runnerFailed: true } }, { code: 'CONFIGURATION_ERROR' }],
    [{ timedOut: true }, { code: 'LIMIT_EXCEEDED' }],
    [{ aborted: true }, { name: 'AbortError' }],
  ]) {
    const shell = { resolve: spec => spec, execute: async () => ({ result: async () => ({ ...runResult(success), ...extra }) }) };
    const ctx = { get: name => name === 'shell' ? shell : undefined };
    await assert.rejects(runCli(ctx, args, {}, config, new AbortController().signal), expected);
  }
});
