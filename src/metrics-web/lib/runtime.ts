import 'server-only';
import { MetricsReportWebClient, validateReportWebConfig } from '../../../src/server/reports/web-client';

let service: MetricsReportWebClient | null = null;
export function reportsRuntime(): MetricsReportWebClient | null {
  // No database, source credential or PLG config fallback in the web process.
  if (process.env.METRICS_BIGQUERY_ENABLED !== 'false') return null;
  try {
    const config = validateReportWebConfig(JSON.parse(process.env.METRICS_REPORT_WEB_CONFIG ?? ''));
    service ??= new MetricsReportWebClient(config); return service;
  } catch { return null; }
}
