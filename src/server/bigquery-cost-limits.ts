/** Hard ceilings shared by the canonical cost boundary and pure validators. */
export const BIGQUERY_COST_LIMITS = Object.freeze({
  project: 'hushh-ai-prod',
  database: 'one-plg-production',
  bytesPerStatement: 100 * 1024 * 1024,
  bytesPerUtcDay: 10 * 1024 * 1024 * 1024,
  statementsPerUtcDay: 100,
  statementsPerRequest: 8,
  timeoutMs: 30_000,
  concurrentRequests: 2,
  queuedRequests: 32,
});
