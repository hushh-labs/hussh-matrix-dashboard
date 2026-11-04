import { createOwnerScopeLoader } from './owner-activity-runtime';

/** The existing UAT entry point cannot select another environment. */
export function createUatLiveScopeLoader(sessionEmail: string, fetcher: typeof fetch = fetch, clock = Date.now) {
  return createOwnerScopeLoader('uat', sessionEmail, fetcher, clock);
}
