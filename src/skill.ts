import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-skill';
/** Optional, reversible guidance for choosing the native export tool. */
export function registerGuidanceSkill(ctx: Context): void {
  ctx.inject(['skills'], scoped => {
    scoped.effect(() => scoped.skills.register({
      name: 'bruce-md2word', source: 'runtime',
      description: 'Export Markdown as an editable Word DOCX using word_export.',
      content: '# Markdown to Word\n\nUse word_export for one Markdown file or Markdown text. Supply assetBaseDir for text containing relative images. By default the DOCX is saved under the current project output/ directory; report the actual returned path (a numeric suffix may avoid overwriting). If the administrator selected attachment delivery, return the resulting file attachment instead. Explain any warnings. LaTeX inline and display formulas convert to editable Word equations via Temml. MATH_NOT_CONVERTED preserves full formula source and is a degradation; strict rejects it. Custom macros, equation numbering/references and unsupported math structures are not supported. MERMAID_SMALL_TEXT is an informational readability warning; recommend splitting or simplifying the diagram. It does not trigger strict rejection. Use strict when degraded content must be rejected. Mermaid flowchart, state, sequence, class, ER and XY diagrams render locally as PNG images. This is a lightweight renderer, not full Mermaid compatibility. Unsupported diagrams/directives retain source and emit warnings. Remote images and input SVG are unsupported. Chinese rendering uses local fonts. Do not invent download URLs or treat attachmentId as a path. No setup command or external converter is required.',
    }), 'bruce-md2word guidance');
  });
}
