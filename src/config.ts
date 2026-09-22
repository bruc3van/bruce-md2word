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
const descriptions: Record<keyof Limits, string> = {
  maxMarkdownBytes: 'Markdown 输入的最大字节数。',
  maxImageBytes: '单张图片的最大字节数。',
  maxTotalImageBytes: '全部图片的累计最大字节数。',
  maxImages: '单次导出的最大图片数量，包含 Mermaid 图。',
  maxImagePixels: '单张图片的最大像素总数。',
  maxImageDimension: '单张图片任一边的最大像素数。',
  maxOutputBytes: '生成 DOCX 的最大字节数。',
  timeoutMs: '任务超时毫秒数，包含排队时间；执行器还可施加更短上限。',
  concurrency: '每个插件实例同时执行的最大任务数。',
  queueSize: '等待队列容量，0 表示不允许排队。',
  maxDiagnostics: '单次导出返回的最大诊断数量。',
};
export const Config: z<Config> = z.object({
  ...Object.fromEntries((Object.keys(defaults) as (keyof Limits)[]).map(key => [key,
    z.number().min(key === 'queueSize' ? 0 : 1).max(key === 'timeoutMs' ? 2_147_483_647 : Number.MAX_SAFE_INTEGER)
      .step(1).default(defaults[key]).description(descriptions[key]),
  ])),
  workspaceRoot: z.string().description('非会话调用使用的绝对项目目录；会话 cwd 优先。'),
  allowedReadRoots: z.array(z.string()).default([]).description('额外允许读取的绝对目录，不扩展输出范围。'),
  skill: z.boolean().default(true).description('在 skills 服务可用时注册导出使用说明。'),
  delivery: z.union(['project', 'attachment']).default('project').description('project 需要 shell 服务；attachment 需要 fs 和 attachments 服务。'),
  cliCommand: z.string().description('管理员指定的 CLI 命令；不设置时使用包内 CLI。'),
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
