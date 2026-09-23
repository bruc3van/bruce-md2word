/** One document-scoped configuration shared by CLI and DSH exports. Units are pt/mm. */
export interface DocumentOptions {
  preset: 'chinese-report' | 'technical';
  font: string;
  headingFont: string;
  fontSize: number;
  lineSpacing: number;
  firstLineIndent: number;
  margins: { top: number; bottom: number; left: number; right: number };
  title: string;
  header: string;
  footer: string;
  pageNumbers: boolean;
  toc: boolean;
  tocDepth: number;
  headingNumbering: boolean;
}
export function documentDefaults(): DocumentOptions {
  return { preset: 'chinese-report', font: 'SimSun', headingFont: 'SimHei', fontSize: 12,
    lineSpacing: 1.5, firstLineIndent: 2, margins: { top: 25, bottom: 25, left: 25, right: 25 },
    title: '', header: '', footer: '', pageNumbers: false, toc: false, tocDepth: 3, headingNumbering: false };
}
export const mmToTwips = (mm: number): number => Math.round(mm * 1440 / 25.4);
export function parseDocumentOptions(source: string): DocumentOptions {
  const input: unknown = JSON.parse(source);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Document configuration must be a JSON object.');
  const values = input as Record<string, unknown>;
  const result = documentDefaults();
  if (values.preset !== undefined && (typeof values.preset !== 'string' || !['chinese-report', 'technical'].includes(values.preset))) throw new Error('Unknown document preset.');
  if (values.preset === 'technical') Object.assign(result, { preset: 'technical', font: 'Microsoft YaHei', headingFont: 'Microsoft YaHei', fontSize: 11, lineSpacing: 1.3, firstLineIndent: 0 });
  for (const [key, value] of Object.entries(values)) {
    if (!Object.hasOwn(result, key)) throw new Error(`Unknown document option: ${key}.`);
    if (key === 'margins') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('margins must be an object.');
      for (const [side, mm] of Object.entries(value)) {
        if (!Object.hasOwn(result.margins, side) || typeof mm !== 'number' || !Number.isFinite(mm) || mm < 10 || mm > 50) throw new Error('Margins must be 10–50 mm.');
        result.margins[side as keyof DocumentOptions['margins']] = mm;
      }
    } else if (['font', 'headingFont', 'title', 'header', 'footer'].includes(key)) {
      if (typeof value !== 'string' || value.length > 256 || /[\u0000-\u001f]/u.test(value) || (key.endsWith('Font') || key === 'font') && !value.trim()) throw new Error(`Invalid text option: ${key}.`);
      Object.assign(result, { [key]: value });
    } else if (['toc', 'pageNumbers', 'headingNumbering'].includes(key)) {
      if (typeof value !== 'boolean') throw new Error(`${key} must be boolean.`);
      Object.assign(result, { [key]: value });
    } else if (key !== 'preset') {
      const ranges: Record<string, [number, number]> = { fontSize: [8, 24], lineSpacing: [1, 3], firstLineIndent: [0, 4], tocDepth: [1, 6] };
      const [min, max] = ranges[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || key === 'tocDepth' && !Number.isInteger(value)) throw new Error(`Invalid numeric option: ${key}.`);
      Object.assign(result, { [key]: value });
    }
  }
  return result;
}
