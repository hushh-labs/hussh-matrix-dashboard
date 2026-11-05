import { useCallback } from 'react';
import type { PlgAudienceFilters, PlgAudiencePage } from '../lib/plg';
import { MatrixBrand } from './MatrixBrand';
import { PlgAudiencePanel } from './PlgAudiencePanel';

/** UAT directory and own activity use separate endpoints; no Production state is loaded. */
export function PlgUatWorkspace() {
  const load = useCallback(async (filters: PlgAudienceFilters, signal: AbortSignal): Promise<PlgAudiencePage> => {
    const response = await fetch('/api/plg/uat/audience', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(filters) });
    const page = await response.json();
    if (!response.ok || page.environment !== 'uat' || page.version !== 2 ||
      page.customerReporting !== false || page.deliveryAuthorized !== false)
      throw new Error('UAT activity is unavailable. No activity or email outcome was inferred.');
    return page;
  }, []);
  return <main className="mx-auto min-h-screen max-w-[1400px] space-y-6 bg-canvas p-5 sm:p-8">
    <MatrixBrand />
    <header className="space-y-3 text-ink">
      <h1 className="text-2xl font-semibold">UAT PLG workspace</h1>
      <p className="text-sm text-muted">Explore registered UAT users and their captured agent activity. Each user chooses activity emails in their UAT One account.</p>
      <nav className="flex flex-wrap gap-4 text-sm font-semibold" aria-label="UAT testing">
        <a href="/plg/uat">My UAT activity</a>
        <a href="https://uat.one.hushh.ai/" target="_blank" rel="noreferrer">Open One UAT</a>
        <a href="/plg">Production workspace</a>
      </nav>
    </header>
    <PlgAudiencePanel state={{ contacts: [] }} load={load} openContact={() => undefined} />
  </main>;
}
