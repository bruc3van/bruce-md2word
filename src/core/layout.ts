/** Approximate text width in 12pt half-width characters, not browser pixels. */
export function textColumns(text: string): number {
  return Array.from(text).reduce((n, ch) => n + (/[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\uffef]/u.test(ch) ? 2 : 1), 0);
}
export function columnWidths(rows: Element[], count: number, total: number, ratios?: number[]): number[] {
  const weights = ratios ?? Array.from({ length: count }, (_, i) => {
    const lengths = rows.map(row => textColumns(row.children[i]?.textContent ?? ''));
    // Bound long prose's share while leaving compact identifier columns useful.
    return Math.max(6, Math.min(40, Math.sqrt(Math.max(1, ...lengths)) * 3));
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  const floor = ratios ? 0 : Math.min(900, Math.floor(total / count / 2));
  const widths = weights.map(w => Math.floor(floor + (total - floor * count) * w / sum));
  for (let i = 0, remaining = total - widths.reduce((a, b) => a + b, 0); i < remaining; i++) widths[i % count]++;
  return widths;
}
export function estimatedLines(text: string, widthTwips: number): number {
  const columns = Math.max(1, widthTwips / 120);
  return text.split('\n').reduce((lines, line) => lines + Math.max(1, Math.ceil(textColumns(line) / columns)), 0);
}
