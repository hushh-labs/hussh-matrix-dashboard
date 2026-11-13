import { Ga4AcquisitionSource, OneAdoptionSource, type AggregateFetch } from './sources';
import { googleAggregateFetch, readAggregateSecret, signedOneAggregateFetch } from './transports';
import type { SourceFactory } from './lifecycle';
import type { ReportStore } from './store';

/** Secrets and provider credentials exist only inside the collector process. */
export function collectorSourceFactory(store: ReportStore, options: {
  google?: typeof googleAggregateFetch; secret?: typeof readAggregateSecret; one?: typeof signedOneAggregateFetch;
  now?: () => number;
} = {}): SourceFactory {
  return async (_job, binding, signal) => {
    const policy = { sourceGeneration: binding.sourceGeneration, timeoutMs: binding.timeoutMs, maxResponseBytes: binding.maxResponseBytes };
    if (binding.kind === 'ga4') {
      const transport = (options.google ?? googleAggregateFetch)(`https://analyticsdata.googleapis.com/v1beta/properties/${binding.propertyId}:runReport`);
      const fetch: AggregateFetch = (url, request) => transport(url, { ...request, signal: AbortSignal.any([signal, request.signal]) });
      return new Ga4AcquisitionSource(store, policy, { propertyId: binding.propertyId, timezone: binding.timezone, informationWatermark: null }, fetch, options.now);
    }
    // Retrieve the pinned key lazily, only if the journal admits network work.
    const fetch: AggregateFetch = async (url, request) => {
      const combined = AbortSignal.any([signal, request.signal]);
      const secret = await (options.secret ?? readAggregateSecret)(binding.secretVersion, combined);
      try { return await (options.one ?? signedOneAggregateFetch)(binding.environment, secret)(url, { ...request, signal: combined }); }
      finally { secret.fill(0); }
    };
    return new OneAdoptionSource(store, policy, binding.environment, fetch, options.now);
  };
}
