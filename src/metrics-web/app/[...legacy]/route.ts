import { forwardMetricsCompatibility } from '../../../server/reports/compatibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function operationalRoute(request: Request) {
  let config: unknown = null;
  try { config = JSON.parse(process.env.METRICS_LEGACY_WEB_CONFIG ?? ''); } catch { /* default closed */ }
  return forwardMetricsCompatibility(request, config);
}
export { operationalRoute as GET, operationalRoute as HEAD, operationalRoute as POST,
  operationalRoute as PUT, operationalRoute as DELETE, operationalRoute as PATCH, operationalRoute as OPTIONS };
