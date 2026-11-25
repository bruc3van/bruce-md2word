import type { Context } from '@deepseek-ai/cordis';
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-shell';
import type {} from '@deepseek-ai/dsh-sandbox-policy';
import { HarnessError } from '@deepseek-ai/dsh-llm';
import type { ResolvedConfig } from '../config.js';
import { defaults } from '../config.js';
import type { WordExportInput } from './paths.js';
import type { Diagnostic } from '../core/diagnostics.js';
import { ExportError, ContentIncompleteError } from './errors.js';
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Node major versions the CLI supports (`engines: ^24 || ^26`). */
const NODE_ENGINE_MAJORS = new Set([24, 26]);
const WINDOWS_SCRIPT = /\.(?:cmd|bat)$/i;

function pathApiFor(platform: NodeJS.Platform): typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix;
}

/**
 * Trim and unquote one PATH entry. Windows PATH values do carry surrounding
 * quotes and stray spaces; relative entries are dropped because existence is
 * checked here but execution happens in the session workdir.
 */
function normalizePathEntry(entry: string, platform: NodeJS.Platform): string | undefined {
  let value = entry.trim();
  while (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) value = value.slice(1, -1).trim();
    else break;
  }
  if (value === '') return undefined;
  return pathApiFor(platform).isAbsolute(value) ? value : undefined;
}

/** Executable names a PATH lookup tries, in order, for one platform. */
export function nodeCandidateNames(platform: NodeJS.Platform): string[] {
  return platform === 'win32' ? ['node.exe', 'node.cmd', 'node'] : ['node'];
}

/** Every `node` candidate on PATH, in the order the host would resolve them. */
export function listNodeOnPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const pathApi = pathApiFor(platform);
  const separator = platform === 'win32' ? ';' : ':';
  const names = nodeCandidateNames(platform);
  const value = env.PATH ?? env.Path ?? '';
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const raw of value.split(separator)) {
    const directory = normalizePathEntry(raw, platform);
    if (directory === undefined) continue;
    for (const name of names) {
      const candidate = pathApi.join(directory, name);
      const key = platform === 'win32' ? candidate.toLowerCase() : candidate;
      if (seen.has(key)) continue;
      seen.add(key);
      // A directory named `node` must not shadow a real executable further down PATH.
      let stat;
      try { stat = statSync(candidate); } catch { continue; }
      if (stat.isFile()) candidates.push(candidate);
    }
  }
  return candidates;
}

/** First `node` executable on PATH, in the order the host would resolve it. */
export function findNodeOnPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
  return listNodeOnPath(env, platform)[0];
}

export function isSupportedNodeMajor(major: number | undefined): boolean {
  return major !== undefined && NODE_ENGINE_MAJORS.has(major);
}

const nodeMajorCache = new Map<string, number | undefined>();

/** Major version of a Node-compatible executable; undefined when it cannot be probed. */
export function probeNodeMajor(executable: string): number | undefined {
  // `.cmd` shims need a shell to run, so they cannot be probed from here.
  if (process.platform === 'win32' && WINDOWS_SCRIPT.test(executable)) return undefined;
  const key = process.platform === 'win32' ? executable.toLowerCase() : executable;
  if (nodeMajorCache.has(key)) return nodeMajorCache.get(key);
  let major: number | undefined;
  try {
    const result = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    if (result.status === 0) {
      const match = /^v?(\d+)\./.exec((result.stdout ?? '').trim());
      if (match !== null) major = Number(match[1]);
    }
  } catch { major = undefined; }
  nodeMajorCache.set(key, major);
  return major;
}

/**
 * First PATH candidate the CLI can run: a Windows `.cmd`/`.bat` shim is trusted
 * (the desktop generates it around its own Node), everything else must report a
 * supported major version. An outdated Node earlier on PATH is skipped instead
 * of failing the export.
 */
export function selectUsableNode(
  candidates: readonly string[],
  probe: (executable: string) => number | undefined,
): string | undefined {
  for (const candidate of candidates) {
    if (WINDOWS_SCRIPT.test(candidate)) return candidate;
    if (isSupportedNodeMajor(probe(candidate))) return candidate;
  }
  return undefined;
}

export interface BundledCommandOptions {
  windows: boolean;
  electron: boolean;
  execPath: string;
  entry: string;
  args?: string;
  nodePath?: string;
  fallbackExec?: string;
}

/**
 * Command line that runs the bundled CLI.
 *
 * A plain Node host runs scripts through `process.execPath`, which is Node
 * itself. An Electron host (DSH Desktop) uses that same property for the GUI
 * executable: starting it only opens the app and returns an empty stdout, which
 * surfaces as "CLI returned invalid JSON". There, prefer a usable `node` on
 * PATH (system Node or the desktop's shim), and fall back to the host binary
 * with Node mode enabled explicitly for this command only.
 */
export function buildBundledCommand(options: BundledCommandOptions): string {
  const { windows, electron, execPath, entry } = options;
  const quote = (value: string) => "'" + value.replaceAll("'", windows ? "''" : "'\\''") + "'";
  const args = options.args?.trim() ?? '';
  const suffix = args === '' ? '' : ` ${args}`;
  if (!electron) return `${windows ? '& ' : ''}${quote(execPath)} ${quote(entry)}${suffix}`;
  if (options.nodePath !== undefined && options.nodePath !== '') {
    return `${windows ? '& ' : ''}${quote(options.nodePath)} ${quote(entry)}${suffix}`;
  }
  const fallback = options.fallbackExec?.trim() || execPath;
  if (windows) {
    // Set Node mode for this shell invocation only; the host runs each command
    // in its own process, and `cmd`-style quoting does not survive PowerShell
    // parsing of nested quotes.
    return `$env:ELECTRON_RUN_AS_NODE='1'; & ${quote(fallback)} ${quote(entry)}${suffix}`;
  }
  return `ELECTRON_RUN_AS_NODE=1 ${quote(fallback)} ${quote(entry)}${suffix}`;
}

function bundledCommand(args: string): string {
  const windows = process.platform === 'win32';
  const entry = fileURLToPath(new URL('../cli.js', import.meta.url));
  const electron = Boolean(process.versions.electron);
  if (!electron) return buildBundledCommand({ windows, electron, execPath: process.execPath, entry, args });
  const nodePath = selectUsableNode(listNodeOnPath(process.env, process.platform), probeNodeMajor);
  return buildBundledCommand({
    windows,
    electron,
    execPath: process.execPath,
    entry,
    args,
    nodePath,
    fallbackExec: process.env.DSH_NODE_EXECUTABLE,
  });
}

function validDiagnostics(value: unknown, limit: number): value is Diagnostic[] {
  return Array.isArray(value) && value.length <= limit && value.every(w => w
    && typeof w.code === 'string' && /^[A-Z_]{1,64}$/.test(w.code)
    && typeof w.message === 'string' && w.message.length <= 300
    && ['info', 'degradation'].includes(w.severity)
    && (w.line === undefined || Number.isSafeInteger(w.line) && w.line > 0));
}

export interface CliResult { path: string; fileName: string; mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; sizeBytes: number; warnings: Diagnostic[] }
export async function runCli(ctx: Context, args: WordExportInput, exec: ToolExecution, config: ResolvedConfig, signal: AbortSignal): Promise<CliResult> {
  const shell = ctx.get('shell');
  if (!shell) throw new ExportError('Project delivery requires the DSH shell executor.', 'CONFIGURATION_ERROR');
  const cwd = exec.agent?.session.header.cwd ?? config.workspaceRoot;
  if (!cwd || !path.isAbsolute(cwd)) throw new ExportError('An absolute session cwd or workspaceRoot is required.', 'CONFIGURATION_ERROR');
  const policyService = ctx.get('sandboxPolicy');
  if (shell.sandboxMode !== undefined && !policyService) throw new ExportError('The confining shell executor requires sandboxPolicy.', 'CONFIGURATION_ERROR');
  const sandboxPolicy = policyService?.resolve(exec.agent ? { session: exec.agent.session } : {});
  const options = { ...Object.fromEntries(Object.keys(defaults).map(key => [key, config[key as keyof typeof defaults]])), allowedReadRoots: config.allowedReadRoots };
  const stdin = JSON.stringify({ protocol: 1, input: args, config: options });
  if (Buffer.byteLength(stdin) > 32 * 1024 * 1024) throw new ExportError('CLI request exceeds the transport limit.', 'LIMIT_EXCEEDED');
  // Only administrator configuration becomes shell syntax. Model-controlled
  // paths, Markdown and filenames travel exclusively through stdin.
  const command = config.cliCommand === undefined
    ? bundledCommand('--request')
    : `${config.cliCommand} --request`;
  const spec = shell.resolve({
    command, stdin, workdir: cwd,
    signal, timeoutMs: config.timeoutMs, onExpiry: 'kill', stdoutMaxBytes: 1024 * 1024, sandboxPolicy,
  });
  const result = await (await shell.execute(spec)).result();
  signal.throwIfAborted();
  if (result.sandbox?.denied) throw new HarnessError('DOCX export was denied by the shell sandbox.', 'FS_SANDBOX_DENIED');
  if (result.sandbox?.runnerFailed) throw new ExportError('The configured sandbox runner failed to start DOCX export.', 'CONFIGURATION_ERROR');
  if (result.timedOut) throw new ExportError('Conversion deadline exceeded.', 'LIMIT_EXCEEDED');
  if (result.aborted) throw new DOMException('CLI export canceled.', 'AbortError');
  if (result.exitCode !== 0) {
    // Node/native libraries may emit warning lines before or after our JSON.
    // Only accept the versioned CLI envelope; do not expose arbitrary stderr.
    for (const line of result.stderr.text.split(/\r?\n/).reverse()) {
      let envelope;
      try { envelope = JSON.parse(line); } catch { continue; }
      const reported = envelope?.error;
      if (envelope?.protocol === 1 && typeof reported?.code === 'string' && /^[A-Z_]{1,64}$/.test(reported.code) && typeof reported.message === 'string') {
        if (reported.code === 'CONTENT_INCOMPLETE' && reported.diagnostics !== undefined) {
          if (!validDiagnostics(reported.diagnostics, config.maxDiagnostics)) throw new ExportError('CLI returned invalid error diagnostics.', 'CONVERSION_FAILED');
          throw new ContentIncompleteError(reported.diagnostics);
        }
        throw new HarnessError(reported.message.slice(0, 500), reported.code);
      }
    }
    throw new ExportError(`CLI exited without a valid error response (exit code: ${result.exitCode ?? 'unknown'}).`, 'CONVERSION_FAILED');
  }
  if (result.stdout.truncated) throw new ExportError('CLI result exceeded the response limit.', 'LIMIT_EXCEEDED');
  let value: CliResult & { protocol: number };
  try { value = JSON.parse(result.stdout.text); } catch { throw new ExportError('CLI returned invalid JSON.', 'CONVERSION_FAILED'); }
  if (!value || value.protocol !== 1 || typeof value.path !== 'string' || !value.path || typeof value.fileName !== 'string'
    || value.mimeType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes <= 0 || value.sizeBytes > config.maxOutputBytes
    || !validDiagnostics(value.warnings, config.maxDiagnostics)) throw new ExportError('CLI returned an invalid export result.', 'CONVERSION_FAILED');
  return { path: value.path, fileName: value.fileName, mimeType: value.mimeType, sizeBytes: value.sizeBytes, warnings: value.warnings };
}
