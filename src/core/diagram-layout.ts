import type { MermaidGraph } from 'beautiful-mermaid';

// Approximate visual columns, preserving grapheme clusters and existing breaks.
const graphemes = new Intl.Segmenter('zh', { granularity: 'grapheme' });
const words = new Intl.Segmenter('en', { granularity: 'word' });
const wide = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}\u3000-\u303f\uff01-\uff60]/u;
const columns = (text: string): number => [...graphemes.segment(text)].reduce((sum, { segment }) => sum + (wide.test(segment) ? 2 : 1), 0);

export function wrapDiagramLabel(label: string, maxColumns = 28): string {
  // Preserve inline formatting rather than risk breaking a tag's span across lines.
  if (/<\/?(?:b|strong|i|em|u|s|del)\b/i.test(label)) return label;
  return label.split('\n').map(line => {
    const tokens = [...words.segment(line)].map(({ segment }) => segment);
    const lines: string[] = [];
    let current = '', width = 0;
    const append = (text: string, size: number): void => {
      if (width + size > maxColumns && current) { lines.push(current.trimEnd()); current = ''; width = 0; }
      if (!current && !text.trim()) return;
      current += text; width += size;
    };
    for (const token of tokens) {
      const size = /^&[^;]+;$/.test(token) ? 1 : columns(token);
      if (size <= maxColumns) append(token, size);
      else for (const { segment } of graphemes.segment(token)) append(segment, columns(segment));
    }
    lines.push(current.trimEnd());
    return lines.join('\n');
  }).join('\n');
}

/** Run on parsed labels before ELK sizes nodes and routes connectors. */
export function wrapGraphLabels(graph: MermaidGraph): MermaidGraph {
  for (const node of graph.nodes.values()) node.label = wrapDiagramLabel(node.label);
  for (const edge of graph.edges) if (edge.label) edge.label = wrapDiagramLabel(edge.label);
  return graph;
}
