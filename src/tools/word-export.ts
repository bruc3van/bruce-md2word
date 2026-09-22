import type { Context } from '@deepseek-ai/cordis';
import { defineTool, TOOL_ABORTED } from '@deepseek-ai/dsh-tools';
import { HarnessError, type ContentBlock } from '@deepseek-ai/dsh-llm';
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { ResolvedConfig } from '../config.js';
import { readInput } from '../runtime/paths.js';
import { acquireImages } from '../runtime/assets.js';
import { runWorker } from '../runtime/worker-client.js';
import { TaskQueue } from '../runtime/queue.js';
import { ExportError, ContentIncompleteError } from '../runtime/errors.js';
import { runCli } from '../runtime/cli-client.js';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export function createWordExport(ctx: Context, config: ResolvedConfig, queue: TaskQueue) {
  return defineTool({
    name: 'word_export',
    description: `Export Markdown as editable Word (.docx). ${config.delivery === 'project' ? 'Save in the current project output/ directory, never overwriting an existing file; return the actual file path.' : 'Save through the DSH attachment service.'} Images are limited to embedded PNG/JPEG/GIF/BMP or relative files in the document directory. Mermaid flowchart, state, sequence, class, ER and XY diagrams render locally as images using a lightweight renderer; not all Mermaid syntax is supported. LaTeX formulas convert to editable Word equations; unsupported formulas retain full source and emit MATH_NOT_CONVERTED degradation. Remote images are never fetched. Inspect warnings for missing images or unrendered Mermaid; strict rejects degraded output.`,
    parameters: {
      source: { required: true, oneOf: [
        { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'file', required: true }, path: { type: 'string', required: true, description: '.md or .markdown path, relative to the session working directory.' } } },
        { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'markdown', required: true }, text: { type: 'string', required: true }, assetBaseDir: { type: 'string', description: 'Directory for relative images, within the session workspace or configured reading roots.' } } },
      ] },
      fileName: { type: 'string', description: 'Filename only, no directory. Defaults to the source basename or document.docx. Project delivery adds a numeric suffix on collision.' },
      strict: { type: 'boolean', description: 'Reject content degradation before saving. Default false.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        attachment: { type: 'object', additionalProperties: false, properties: { attachmentId: { type: 'string', required: true }, name: { type: 'string', required: true }, bytes: { type: 'integer', required: true } } },
        path: { type: 'string', description: 'Actual host-local DOCX path, present for project delivery.' },
        fileName: { type: 'string', required: true }, mimeType: { type: 'string', const: DOCX_MIME, required: true }, sizeBytes: { type: 'integer', required: true },
        warnings: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { code: { type: 'string', required: true }, message: { type: 'string', required: true }, severity: { type: 'string', enum: ['info', 'degradation'], required: true }, line: { type: 'integer' } } } },
      } },
      render: (_args, value): ContentBlock[] => [
        { type: 'text', text: `Created ${value.fileName} (${value.sizeBytes} bytes).${value.path ? `\nSaved to: ${value.path}` : ''}${value.warnings.length ? '\n' + value.warnings.map(w => `${w.code}${w.line === undefined ? '' : ` (line ${w.line})`}: ${w.message}`).join('\n') : ''}` },
        // Schema validation preserves the opaque provider id; this cast only restores its TypeScript brand.
        ...(value.attachment ? [{ type: 'file' as const, attachment: value.attachment as FileAttachmentRef }] : []),
      ],
    },
    presentCall: args => ({ card: 'generic', title: 'Export Word document', ...(args.source.kind === 'file' ? { locations: [{ path: args.source.path }] } : {}) }),
    async execute(args, exec) {
      try { return await queue.run(exec.signal, async signal => {
        if (config.delivery === 'project') return runCli(ctx, args, exec, config, signal);
        const input = await readInput(ctx.fs, args, exec, config, signal);
        const attachments = ctx.get('attachments');
        if (!attachments) throw new ExportError('Attachment delivery requires the DSH attachment service.', 'CONFIGURATION_ERROR');
        const result = await runWorker(input.markdown, config, signal, (refs, ioSignal) => acquireImages(ctx.fs, refs, input, config, ioSignal));
        signal.throwIfAborted();
        if (args.strict && result.warnings.some(w => w.severity === 'degradation')) throw new ContentIncompleteError(result.warnings);
        const attachment = await attachments.saveFile({ data: result.data, name: input.fileName });
        // Storage owns any committed object if cancellation races with saveFile.
        signal.throwIfAborted();
        return { attachment, fileName: attachment.name, mimeType: DOCX_MIME, sizeBytes: attachment.bytes, warnings: result.warnings };
      }); } catch (cause) {
        if (exec.signal.aborted) {
          const error = new HarnessError('Word export was canceled.', TOOL_ABORTED, { cause });
          error.name = 'AbortError';
          throw error;
        }
        throw cause;
      }
    },
  });
}
