// Only the bundled renderer's copy of this module is read while drawing.
let fontScale = 1;
/** Uniform text scale for the pinned renderer; spacing and padding are unchanged. */
export function diagramFontScale(): number {
  return fontScale;
}
/** Scope a scale to one synchronous render. */
export function withDiagramFontScale<T>(scale: number, render: () => T): T {
  const previous = fontScale;
  fontScale = scale;
  try { return render(); } finally { fontScale = previous; }
}

/** Shared by the pinned renderer's layout and SVG stages. Values are pixels. */
export function diagramFontSize(style?: Record<string, string>): number {
  return (parseDiagramFontSize(style?.['font-size']) ?? 13) * fontScale;
}

export function parseDiagramFontSize(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = /^(\d+(?:\.\d+)?)(px|pt)?$/.exec(value);
  const size = match ? Number(match[1]) * (match[2] === 'pt' ? 4 / 3 : 1) : NaN;
  if (!Number.isFinite(size) || size < 6 || size > 96) return undefined;
  return size;
}

export function diagramDash(style?: Record<string, string>): string | undefined {
  return parseDiagramDash(style?.['stroke-dasharray']);
}

export function parseDiagramDash(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value === 'none') return 'none';
  if (!/^\d+(?:\.\d+)?(?:[ ,]+\d+(?:\.\d+)?)*$/.test(value)) return undefined;
  const parts = value.split(/[ ,]+/).map(Number);
  if (parts.length > 16 || parts.some(n => n > 1000) || parts.every(n => n === 0)) return undefined;
  return parts.join(' ');
}
