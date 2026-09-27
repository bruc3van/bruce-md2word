import { fileURLToPath } from 'node:url';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-skill';
import type { ResolvedConfig } from './config.js';
/** Package root, so relative references such as docs/document-layout.md resolve. */
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
export function guidanceContent(delivery: ResolvedConfig['delivery']): string {
  const saving = delivery === 'project'
    ? 'The DOCX is saved under the current project output/ directory without overwriting; report the actual returned path (a numeric suffix may be added). fileName sets only the file name, never a directory.'
    : 'The DOCX is delivered as a file attachment; return that attachment. Do not invent download URLs or treat attachmentId as a path.';
  return `# Markdown to Word

Call word_export; no setup command, CLI install or external converter is required.

## Export

- Prefer source {kind:"file"} for an existing .md/.markdown file; relative images resolve against its directory. For generated text use {kind:"markdown"} and supply assetBaseDir when it references relative images.
- ${saving}
- Use strict:true for final deliverables so degraded content is rejected. A CONTENT_INCOMPLETE error lists each diagnostic code and line; fix the Markdown and export again rather than dropping strict.
- Explain every returned warning. Severity "degradation" fails strict; "info" does not. Stop retrying when the same failure repeats without a new fix.

## Capabilities and limits

- PNG/JPEG/GIF/BMP images embed (animated images keep only the first frame: IMAGE_FIRST_FRAME). Remote images are never fetched and input SVG is unsupported.
- Mermaid flowchart, state, sequence, class, ER and XY diagrams render locally as PNG with a lightweight renderer, not full Mermaid compatibility. Unsupported diagrams retain source with MERMAID_NOT_RENDERED. MERMAID_LAYOUT_ADJUSTED (a too-wide flowchart was reflowed vertically), MERMAID_TEXT_ENLARGED (diagram text was enlarged up to 1.5x before layout), MERMAID_SMALL_TEXT (recommend splitting or simplifying) and MERMAID_STYLE_UNSUPPORTED (some flowchart styling not applied) are informational. Chinese labels use local fonts.
- LaTeX inline and display formulas become editable Word equations. MATH_NOT_CONVERTED keeps the full source and is a degradation. Custom macros and equation numbering/references are unsupported.
- Named footnotes become native Word footnotes. At most 1000 formulas and 1000 footnote definitions per export; beyond that the export fails with LIMIT_EXCEEDED, so split long documents.
- Custom Word templates and editing existing DOCX files are not supported.

## Layout

Keep the default Chinese report layout unless the user asks otherwise. Options go in one directive as the first block, for example <!-- word:document {"preset":"technical","toc":true,"pageNumbers":true} -->; presets are chinese-report and technical. Font, size and margin overrides, heading numbering, figure/table captions and cross-references, landscape sections, table widths, list continuation and footnotes are documented in docs/document-layout.md. TOC, page numbers and references need a field update and visual check in Word/WPS.`;
}
/** Optional, reversible guidance for choosing the native export tool. */
export function registerGuidanceSkill(ctx: Context, delivery: ResolvedConfig['delivery']): void {
  ctx.inject(['skills'], scoped => {
    scoped.effect(() => scoped.skills.register({
      name: 'bruce-md2word', source: 'runtime',
      description: 'Export Markdown or a newly written report as an editable Word DOCX with the native word_export tool, with Chinese layout, Mermaid diagrams and editable equations.',
      whenToUse: 'The user wants a .docx/Word deliverable from Markdown or from content you write. Not for reading or editing existing Word files, PDF conversion or custom Word templates.',
      resourceBase: { kind: 'directory', path: packageRoot },
      content: guidanceContent(delivery),
    }), 'bruce-md2word guidance');
  });
}
