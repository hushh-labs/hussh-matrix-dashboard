import { ReportError } from '../../../src/server/reports/contracts';

export function reportFailure(error: unknown) {
  const code = error instanceof ReportError ? error.code : 'unavailable';
  const status = { invalid: 400, unauthorized: 403, unavailable: 503, quota: 429, capacity: 429, stale_worker: 409 }[code];
  return Response.json({ state: code, message: status === 400 ? 'Choose a valid report and period.' :
    status === 429 ? 'Metrics is busy. Please try again later.' : 'This report is currently unavailable.' },
  { status, headers: { 'Cache-Control': 'private, no-store' } });
}
