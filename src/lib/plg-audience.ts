import type { PlgAudienceFilters, PlgAudiencePage } from './plg';

/** A filtered source page can be empty even when later pages have matches. */
export async function findAudiencePage(
  load: (filters: PlgAudienceFilters, signal: AbortSignal) => Promise<PlgAudiencePage>,
  filters: PlgAudienceFilters,
  signal: AbortSignal,
  progress: (scanned: number) => void = () => {},
  clock: () => number = Date.now,
) {
  const started = clock();
  const cursors = new Set<string>();
  let cursor = filters.cursor ?? null;
  let scanned = 0;
  let pages = 0;
  while (true) {
    signal.throwIfAborted();
    const page = await load({ ...filters, cursor }, signal);
    signal.throwIfAborted();
    scanned += page.scanned;
    pages++;
    progress(scanned);
    if (page.rows.length || !page.nextCursor || pages >= 6 || clock() - started >= 20_000 ||
      (filters.segment === 'all' && !filters.query.trim())) return { page, scanned, pages };
    if (cursors.has(page.nextCursor) || page.nextCursor === cursor)
      throw new Error('The people directory did not advance. Refresh and try again.');
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

export function outcomeCoverage(page: Pick<PlgAudiencePage, 'catalog'>) {
  const agents = page.catalog.agents.filter((agent) => agent.public && agent.available);
  const measured = agents.filter((agent) => agent.outcome?.status === 'supported' ||
    (!agent.outcome && ['agent_personal_information', 'agent_email'].includes(agent.id)));
  return { measured: measured.length, agents: agents.length, legacy: agents.some((agent) => !agent.outcome) };
}
