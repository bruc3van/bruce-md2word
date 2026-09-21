/** Bounded diagnostics shared across the host and worker. */
export interface Diagnostic {
  code: string;
  message: string;
  severity: 'info' | 'degradation';
  line?: number;
}
export class Diagnostics {
  readonly items: Diagnostic[] = [];
  private omitted = 0;
  constructor(private readonly limit: number) {}
  add(code: string, message: string, severity: Diagnostic['severity'] = 'degradation', line?: number): void {
    const item: Diagnostic = { code, message: message.slice(0, 300), severity, ...(line === undefined ? {} : { line }) };
    if (this.items.length < this.limit) this.items.push(item);
    else {
      this.omitted++;
      this.items[this.limit - 1] = { code: 'DIAGNOSTICS_TRUNCATED', message: `Additional diagnostics omitted (${this.omitted + 1}).`, severity: 'degradation' };
    }
  }
}
