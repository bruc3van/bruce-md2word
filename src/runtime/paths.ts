import path from 'node:path';
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs';
import { FsError } from '@deepseek-ai/dsh-fs';
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
import type { ResolvedConfig } from '../config.js';
import { ExportError } from './errors.js';
export type Source = { kind: 'file'; path: string } | { kind: 'markdown'; text: string; assetBaseDir?: string };
export interface WordExportInput { source: Source; fileName?: string; strict?: boolean }
export interface InputData { markdown: string; fileName: string; assetBase?: string; assetRoot?: FsTarget }
export function outputName(input: string): string {
  if (!input.trim() || input !== input.trim() || /[<>:"/\\|?*\x00-\x1f]/.test(input) || /[. ]$/.test(input) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(input)) throw new ExportError('fileName must be a plain valid filename.', 'INVALID_INPUT');
  const name = input.replace(/\.docx$/i, '') + '.docx';
  if (Buffer.byteLength(name) > 240) throw new ExportError('fileName is too long.', 'INVALID_INPUT');
  return name;
}
export async function readInput(fs: FileSystem, input: WordExportInput, exec: ToolExecution, config: ResolvedConfig, signal: AbortSignal): Promise<InputData> {
  signal.throwIfAborted();
  const cwd = exec.agent?.session.header.cwd ?? config.workspaceRoot;
  if (!cwd || !path.isAbsolute(cwd)) throw new ExportError('A session cwd or absolute workspaceRoot is required.', 'CONFIGURATION_ERROR');
  const roots = await Promise.all([cwd, ...config.allowedReadRoots].map(root => fs.resolve(root, { signal })));
  const allowed = (target: FsTarget): void => { if (!roots.some(root => fs.contains(root, target))) throw new FsError('Input is outside the allowed reading roots.', 'FS_SANDBOX_DENIED'); };
  let markdown: string;
  let assetBase: string | undefined;
  let defaultName = 'document.docx';
  if (input.source.kind === 'file') {
    if (!input.source.path.trim() || !/\.(md|markdown)$/i.test(input.source.path)) throw new ExportError('source.path must name a .md or .markdown file.', 'INVALID_INPUT');
    const absolute = path.resolve(cwd, input.source.path);
    const target = await fs.resolve(input.source.path, { cwd, signal });
    allowed(target);
    const info = await fs.stat(target, signal);
    if (!info) throw new FsError('Markdown file does not exist.', 'FS_NOT_FOUND');
    if (info.type !== 'file') throw new FsError('Markdown input is not a regular file.', 'FS_NOT_REGULAR_FILE');
    if (info.size !== undefined && info.size > config.maxMarkdownBytes) throw new FsError('Markdown input exceeds the configured limit.', 'FS_TOO_LARGE');
    const bytes = await fs.readBytes(target, signal, config.maxMarkdownBytes);
    if (bytes.byteLength > config.maxMarkdownBytes) throw new ExportError('Markdown input exceeds the configured limit.', 'LIMIT_EXCEEDED');
    try { markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (cause) { throw new FsError('Markdown input must be UTF-8.', 'FS_NOT_TEXT', { cause }); }
    assetBase = path.dirname(absolute);
    defaultName = path.basename(absolute).replace(/\.(md|markdown)$/i, '') + '.docx';
  } else {
    markdown = input.source.text.replace(/^\uFEFF/, '');
    if (input.source.assetBaseDir !== undefined) {
      if (!input.source.assetBaseDir.trim()) throw new ExportError('assetBaseDir must not be empty.', 'INVALID_INPUT');
      assetBase = path.resolve(cwd, input.source.assetBaseDir);
    }
  }
  if (!markdown.trim()) throw new ExportError('Markdown input is empty.', 'EMPTY_INPUT');
  if (Buffer.byteLength(markdown, 'utf8') > config.maxMarkdownBytes) throw new ExportError('Markdown input exceeds the configured limit.', 'LIMIT_EXCEEDED');
  let assetRoot: FsTarget | undefined;
  if (assetBase !== undefined) {
    assetRoot = await fs.resolve(assetBase, { cwd, signal });
    allowed(assetRoot);
    if ((await fs.stat(assetRoot, signal))?.type !== 'directory') throw new FsError('Image base is not a directory.', 'FS_NOT_DIRECTORY');
  }
  return { markdown, fileName: outputName(input.fileName ?? defaultName), ...(assetBase === undefined ? {} : { assetBase, assetRoot }) };
}
