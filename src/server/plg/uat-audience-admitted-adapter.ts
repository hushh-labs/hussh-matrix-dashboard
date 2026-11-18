import type { PlgAudiencePage } from '../../lib/plg';
import type { ReportStore } from '../reports/store';
import { readUatAudience } from './one-audience';
import { readAdmittedUatPage } from './uat-audience-admitted-read';

/** Unwired adapter: the caller must supply a fresh authorization check bound to
 * this verified session viewer and the UAT team-audience scope. No such viewer
 * grant is inferred from the service-level source signature. */
export function readAdmittedUatAudience({ store, viewer, key, input, signal, authorize, now = Date.now,
  env = process.env, fetcher = fetch }: {
  store: ReportStore; viewer: string; key: string; input: unknown; signal: AbortSignal;
  authorize: (viewer: string, scope: 'uat-team-audience') => Promise<boolean>; now?: () => number;
  env?: NodeJS.ProcessEnv; fetcher?: typeof fetch;
}): Promise<PlgAudiencePage> {
  return readAdmittedUatPage({ store, viewer, key, now, signal,
    authority: () => authorize(viewer, 'uat-team-audience'),
    read: async active => {
      // readUatAudience consumes a bounded body and validates the UAT page before
      // it resolves; rejected, aborted or malformed responses retain the claim.
      const value = await readUatAudience(input, env, fetcher, now, active);
      return { terminal: true, value };
    },
  });
}
