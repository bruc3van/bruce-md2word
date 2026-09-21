import { HarnessError } from '@deepseek-ai/dsh-llm';
export type ExportErrorCode = 'EMPTY_INPUT' | 'INVALID_INPUT' | 'CONFIGURATION_ERROR' | 'IMAGE_UNAVAILABLE' | 'CONTENT_INCOMPLETE' | 'LIMIT_EXCEEDED' | 'BUSY' | 'CONVERSION_FAILED';
export class ExportError extends HarnessError {
  constructor(message: string, code: ExportErrorCode, options?: ErrorOptions) { super(message, code, options); }
}
