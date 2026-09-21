import path from 'node:path';
import z from '@deepseek-ai/schemastery';
export const defaults = {
  maxMarkdownBytes: 5 * 1024 * 1024,
  maxImageBytes: 20 * 1024 * 1024,
  maxTotalImageBytes: 100 * 1024 * 1024,
  maxImages: 100,
  maxImagePixels: 40_000_000,
  maxImageDimension: 16_384,
  maxOutputBytes: 100 * 1024 * 1024,
  timeoutMs: 120_000,
  concurrency: 1,
  queueSize: 8,
  maxDiagnostics: 100,
};
export type Limits = typeof defaults;
export interface Config extends Partial<Limits> { workspaceRoot?: string; allowedReadRoots?: string[]; skill?: boolean; delivery?: 'project' | 'attachment'; cliCommand?: string }
export type ResolvedConfig = Limits & { workspaceRoot?: string; allowedReadRoots: string[]; skill: boolean; delivery: 'project' | 'attachment'; cliCommand?: string };
export const Config: z<Config> = z.object({
  ...Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, z.number().default(value)])),
  workspaceRoot: z.string(), allowedReadRoots: z.array(z.string()).default([]), skill: z.boolean().default(true),
  delivery: z.union(['project', 'attachment']).default('project'),
  cliCommand: z.string(),
});
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const result = { ...defaults, ...config, allowedReadRoots: config.allowedReadRoots ?? [], skill: config.skill ?? true, delivery: config.delivery ?? 'project' };
  if (result.cliCommand !== undefined && (!result.cliCommand.trim() || /[\r\n\0]/.test(result.cliCommand))) throw new Error('dsh-md2word: invalid cliCommand');
  if (!['project', 'attachment'].includes(result.delivery)) throw new Error('dsh-md2word: invalid delivery');
  for (const key of Object.keys(defaults) as (keyof Limits)[]) {
    if (!Number.isSafeInteger(result[key]) || result[key] < (key === 'queueSize' ? 0 : 1)) throw new Error(`dsh-md2word: invalid ${key}`);
  }
  if (result.timeoutMs > 2_147_483_647) throw new Error('dsh-md2word: timeoutMs exceeds timer range');
  for (const root of [result.workspaceRoot, ...result.allowedReadRoots]) {
    if (root !== undefined && (!root.trim() || !path.isAbsolute(root))) throw new Error('dsh-md2word: roots must be absolute local-provider paths');
  }
  return result;
}
