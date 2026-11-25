import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  buildBundledCommand,
  findNodeOnPath,
  isSupportedNodeMajor,
  listNodeOnPath,
  nodeCandidateNames,
  runCli,
  selectUsableNode,
} from '../lib/runtime/cli-client.js';
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

test('bundled CLI keeps process.execPath as node in a plain Node host', () => {
  assert.equal(
    buildBundledCommand({ windows: true, electron: false, execPath: 'C:\\Program Files\\nodejs\\node.exe', entry: 'C:\\app\\lib\\cli.js', args: '--request' }),
    "& 'C:\\Program Files\\nodejs\\node.exe' 'C:\\app\\lib\\cli.js' --request",
  );
  assert.equal(
    buildBundledCommand({ windows: false, electron: false, execPath: '/usr/bin/node', entry: '/app/lib/cli.js', args: '--request' }),
    "'/usr/bin/node' '/app/lib/cli.js' --request",
  );
});

test('bundled CLI prefers node on PATH under an Electron host', () => {
  assert.equal(
    buildBundledCommand({ windows: true, electron: true, execPath: 'C:\\DSH\\DSH Desktop Pro.exe', entry: 'C:\\app\\lib\\cli.js', args: '--request', nodePath: 'C:\\Users\\u\\.desk\\bin\\node.cmd' }),
    "& 'C:\\Users\\u\\.desk\\bin\\node.cmd' 'C:\\app\\lib\\cli.js' --request",
  );
});

test('Electron fallback enables Node mode for this command only and keeps arguments inside it', () => {
  const fallback = 'C:\\DSH\\DSH Desktop Pro.exe';
  const win = buildBundledCommand({ windows: true, electron: true, execPath: fallback, entry: 'C:\\app\\lib\\cli.js', args: '--request', fallbackExec: fallback });
  assert.equal(win, "$env:ELECTRON_RUN_AS_NODE='1'; & 'C:\\DSH\\DSH Desktop Pro.exe' 'C:\\app\\lib\\cli.js' --request");
  assert.ok(win.endsWith('--request'), 'arguments must be appended, not dropped');
  const posix = buildBundledCommand({ windows: false, electron: true, execPath: '/opt/DSH/desktop', entry: '/app/lib/cli.js', args: '--request', fallbackExec: '/opt/DSH/desktop' });
  assert.equal(posix, "ELECTRON_RUN_AS_NODE=1 '/opt/DSH/desktop' '/app/lib/cli.js' --request");
});

const HOST_PLATFORM = process.platform;
const HOST_NODE_NAME = process.platform === 'win32' ? 'node.exe' : 'node';

test('findNodeOnPath resolves the host node executable', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'md2word-node-'));
  try {
    await writeFile(path.join(directory, HOST_NODE_NAME), '');
    assert.equal(findNodeOnPath({ PATH: directory }, HOST_PLATFORM), path.join(directory, HOST_NODE_NAME));
    assert.equal(findNodeOnPath({ Path: directory }, HOST_PLATFORM), path.join(directory, HOST_NODE_NAME));
    assert.deepEqual(listNodeOnPath({ PATH: directory }, HOST_PLATFORM), [path.join(directory, HOST_NODE_NAME)]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('PATH lookup skips same-named directories, unquotes entries and drops relative ones', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'md2word-node-'));
  try {
    const shadow = path.join(root, 'shadow');
    await mkdir(path.join(shadow, HOST_NODE_NAME), { recursive: true }); // a DIRECTORY named like node
    const real = path.join(root, 'real dir');
    await mkdir(real, { recursive: true });
    await writeFile(path.join(real, HOST_NODE_NAME), '');
    assert.equal(findNodeOnPath({ PATH: shadow }, HOST_PLATFORM), undefined);
    // The directory must not shadow the real executable later on PATH.
    assert.equal(findNodeOnPath({ PATH: `${shadow}${path.delimiter}${real}` }, HOST_PLATFORM), path.join(real, HOST_NODE_NAME));
    assert.equal(findNodeOnPath({ PATH: `"${real}"` }, HOST_PLATFORM), path.join(real, HOST_NODE_NAME));
    assert.equal(findNodeOnPath({ PATH: `  ${real}  ` }, HOST_PLATFORM), path.join(real, HOST_NODE_NAME));
    assert.equal(findNodeOnPath({ PATH: ';;' }, HOST_PLATFORM), undefined);
    const relative = path.relative(process.cwd(), real);
    if (relative !== '' && !path.isAbsolute(relative)) {
      assert.equal(findNodeOnPath({ PATH: relative }, HOST_PLATFORM), undefined);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('PATH order decides which node candidate wins', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'md2word-node-'));
  try {
    const first = path.join(root, 'a');
    const second = path.join(root, 'b');
    await mkdir(first, { recursive: true });
    await mkdir(second, { recursive: true });
    await writeFile(path.join(first, HOST_NODE_NAME), '');
    await writeFile(path.join(second, HOST_NODE_NAME), '');
    assert.deepEqual(
      listNodeOnPath({ PATH: [first, second].join(path.delimiter) }, HOST_PLATFORM),
      [path.join(first, HOST_NODE_NAME), path.join(second, HOST_NODE_NAME)],
    );
    assert.equal(findNodeOnPath({ PATH: [second, first].join(path.delimiter) }, HOST_PLATFORM), path.join(second, HOST_NODE_NAME));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('node candidate names follow the platform', () => {
  assert.deepEqual(nodeCandidateNames('win32'), ['node.exe', 'node.cmd', 'node']);
  assert.deepEqual(nodeCandidateNames('linux'), ['node']);
  assert.deepEqual(nodeCandidateNames('darwin'), ['node']);
});

test('node selection skips unsupported majors and trusts Windows shims', () => {
  assert.equal(selectUsableNode(['old.exe', 'new.exe'], executable => executable === 'new.exe' ? 24 : 20), 'new.exe');
  assert.equal(selectUsableNode(['old.exe'], () => 22), undefined);
  assert.equal(selectUsableNode(['C:\\tools\\node.cmd'], () => { throw new Error('shims must not be probed'); }), 'C:\\tools\\node.cmd');
  assert.equal(selectUsableNode([], () => 24), undefined);
  assert.equal(isSupportedNodeMajor(24), true);
  assert.equal(isSupportedNodeMajor(26), true);
  assert.equal(isSupportedNodeMajor(22), false);
  assert.equal(isSupportedNodeMajor(undefined), false);
});

test('generated Electron command delivers --request and stdin through a real shell', async t => {
  const windows = process.platform === 'win32';
  const shell = windows ? 'pwsh' : 'sh';
  const shellArgs = windows ? ['-NoProfile', '-NonInteractive', '-Command'] : ['-c'];
  const available = spawnSync(shell, windows ? ['-NoProfile', '-Command', 'exit 0'] : ['-c', 'exit 0'], { encoding: 'utf8', windowsHide: true });
  if (available.status !== 0) { t.skip(`${shell} is unavailable`); return; }
  const directory = await mkdtemp(path.join(tmpdir(), 'md2word shell ')); // spaces exercise quoting
  try {
    const entry = path.join(directory, 'entry.mjs');
    await writeFile(entry, "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify({argv:process.argv.slice(2),stdin:s})));");
    const command = buildBundledCommand({ windows, electron: true, execPath: process.execPath, entry, args: '--request', nodePath: process.execPath });
    const payload = '{"hello":"world"}';
    const child = spawn(shell, [...shellArgs, command], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.stdin.end(payload);
    const code = await new Promise(resolve => child.once('close', resolve));
    assert.equal(code, 0, stderr);
    const result = JSON.parse(stdout.trim());
    assert.deepEqual(result.argv, ['--request']);
    assert.equal(result.stdin, payload);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CLI adapter derives the bundled invocation when no cliCommand is configured', async () => {
  const bundledConfig = resolveConfig({ workspaceRoot: '/workspace' });
  let spec;
  const shell = { resolve: x => x, execute: executeResult(async x => { spec = x; return runResult(success); }) };
  const ctx = { get: name => name === 'shell' ? shell : undefined };
  await runCli(ctx, args, {}, bundledConfig, new AbortController().signal);
  assert.match(spec.command, /--request$/);
  assert.doesNotMatch(spec.command, /--request --request/);
  assert.ok(spec.command.includes('cli.js'), spec.command);
});
