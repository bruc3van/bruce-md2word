import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-fs';
import type {} from '@deepseek-ai/dsh-attachment';
import { resolveConfig } from './config.js';
import type { Config as PluginConfig } from './config.js';
import { TaskQueue } from './runtime/queue.js';
import { createWordExport } from './tools/word-export.js';
import { registerGuidanceSkill } from './skill.js';
export { Config } from './config.js';
export const name = 'dsh-md2word';
export const inject = ['tools'];
/** Register one native exporter with per-instance resource ownership. */
export function apply(ctx: Context, config: PluginConfig = {}): void {
  const resolved = resolveConfig(config);
  ctx.inject(resolved.delivery === 'project' ? ['shell'] : ['fs', 'attachments'], scoped => {
    const queue = new TaskQueue(resolved.concurrency, resolved.queueSize, resolved.timeoutMs);
    scoped.effect(() => () => queue.dispose(), 'dsh-md2word tasks');
    scoped.tools.register(createWordExport(scoped, resolved, queue));
    if (resolved.skill) registerGuidanceSkill(scoped);
  });
}
