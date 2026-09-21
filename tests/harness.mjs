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
export async function harness(config = {}, module = plugin) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-md2word-'));
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(LocalFileSystem, { cwd: root });
  await ctx.plugin(LocalAttachmentStore, { dshHome: path.join(root, 'home') });
  await ctx.plugin(Skills);
  const fiber = ctx.plugin(module, { workspaceRoot: root, delivery: 'attachment', ...config });
  await fiber;
  let calls = 0;
  return {
    ctx, root, fiber,
    call(args, signal = new AbortController().signal, agent) { return ctx.tools.execute({ callId: ToolCallId(`export-${++calls}`), name: 'word_export', arguments: args, signal, ...(agent ? { agent } : {}) }); },
    async bytes(ref) { const chunks = []; for await (const chunk of ctx.attachments.readFileStream(ref)) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks); },
    async close() { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); },
  };
}
