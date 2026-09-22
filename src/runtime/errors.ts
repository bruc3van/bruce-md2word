import type { Diagnostic } from '../core/diagnostics.js';
import { HarnessError } from '@deepseek-ai/dsh-llm';
export type ExportErrorCode = 'EMPTY_INPUT' | 'INVALID_INPUT' | 'CONFIGURATION_ERROR' | 'IMAGE_UNAVAILABLE' | 'CONTENT_INCOMPLETE' | 'LIMIT_EXCEEDED' | 'BUSY' | 'CONVERSION_FAILED';
export class ExportError extends HarnessError {
  constructor(message: string, code: ExportErrorCode, options?: ErrorOptions) { super(message, code, options); }
}

/** Structured CLI details, plus readable details for hosts that serialize only message. */
export class ContentIncompleteError extends ExportError {
  constructor(readonly diagnostics: Diagnostic[]) {
    super('Strict export rejected incomplete content.\n' + diagnostics.map(item =>
      `${item.code}${item.line === undefined ? '' : ` (line ${item.line})`}: ${item.message}`,
    ).join('\n'), 'CONTENT_INCOMPLETE');
  }
}
