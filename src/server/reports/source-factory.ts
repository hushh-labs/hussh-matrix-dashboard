import { Ga4AcquisitionSource, OneAdoptionSource, WebsiteActivitySource, type AggregateFetch } from './sources';
import { analyticsReaderCredentialHeaders, googleAggregateFetch, readAggregateSecret, readWebsiteAggregateSecret,
  signedOneAggregateFetch, signedWebsiteAggregateFetch } from './transports';
import type { SourceFactory } from './lifecycle';
import type { ReportStore } from './store';

/** Secrets and provider credentials exist only inside the collector process. */
export function collectorSourceFactory(store: ReportStore, options: {
  google?: typeof googleAggregateFetch; analyticsReader?: typeof analyticsReaderCredentialHeaders;
  secret?: typeof readAggregateSecret; one?: typeof signedOneAggregateFetch;
  websiteSecret?: typeof readWebsiteAggregateSecret; website?: typeof signedWebsiteAggregateFetch;
  now?: () => number;
} = {}): SourceFactory {
  return async (_job, binding, signal) => {
    const policy = { sourceGeneration: binding.sourceGeneration, timeoutMs: binding.timeoutMs, maxResponseBytes: binding.maxResponseBytes };
    if (binding.kind === 'ga4') {
      const credentials = (options.analyticsReader ?? analyticsReaderCredentialHeaders)(binding.readerServiceAccount);
      const transport = (options.google ?? googleAggregateFetch)(`https://analyticsdata.googleapis.com/v1beta/properties/${binding.propertyId}:runReport`, credentials);
      const fetch: AggregateFetch = (url, request) => transport(url, { ...request, signal: AbortSignal.any([signal, request.signal]) });
      return new Ga4AcquisitionSource(store, policy, { propertyId: binding.propertyId, timezone: binding.timezone,
        streamId: binding.streamId, hostnames: binding.hostnames, informationWatermark: null }, fetch, options.now);
    }
    // Retrieve the pinned key lazily, only if the journal admits network work.
    const fetch: AggregateFetch = async (url, request) => {
      const combined = AbortSignal.any([signal, request.signal]);
      const website = binding.kind === 'website';
      const secret = await (website ? options.websiteSecret ?? readWebsiteAggregateSecret : options.secret ?? readAggregateSecret)(binding.secretVersion, combined);
      try { return await (website ? options.website ?? signedWebsiteAggregateFetch : options.one ?? signedOneAggregateFetch)(binding.environment, secret)(url, { ...request, signal: combined }); }
      finally { secret.fill(0); }
    };
    if (binding.kind === 'website') return new WebsiteActivitySource(store, policy, binding.environment, binding.captureGeneration, binding.maxEventsPerDay, fetch, options.now);
    return new OneAdoptionSource(store, policy, binding.environment, fetch, options.now);
  };
}
