import { ReportError } from './contracts';

export class SourceRequestFailure extends ReportError {
  constructor(public kind: 'transient' | 'configuration', public retryAfterMs = 0) { super('unavailable'); }
}
export function providerRetryAfter(value: string | null, now = Date.now()) {
  if (!value) return 0;
  const ms = /^\d+$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isSafeInteger(ms) && ms > 0 ? ms : 0;
}
