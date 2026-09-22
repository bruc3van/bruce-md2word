import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local';
import Skills from '@deepseek-ai/dsh-skill';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as plugin from '../lib/index.js';
export async function harness(config = {}, module = plugin, services = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bruce-md2word-'));
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  const fsFiber = services.fs === false ? undefined : ctx.plugin(LocalFileSystem, { cwd: root });
  await fsFiber;
  const attachmentFiber = services.attachments === false ? undefined : ctx.plugin(LocalAttachmentStore, { dshHome: path.join(root, 'home') });
  await attachmentFiber;
  await ctx.plugin(Skills);
  const fiber = ctx.plugin(module, { workspaceRoot: root, delivery: 'attachment', ...config });
  await fiber;
  let calls = 0;
  return {
    ctx, root, fiber, fsFiber, attachmentFiber,
    call(args, signal = new AbortController().signal, agent) { return ctx.tools.execute({ callId: ToolCallId(`export-${++calls}`), name: 'word_export', arguments: args, signal, ...(agent ? { agent } : {}) }); },
    async bytes(ref) { const chunks = []; for await (const chunk of ctx.attachments.readFileStream(ref)) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks); },
    async close() { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); },
  };
}
