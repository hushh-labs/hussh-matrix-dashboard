import type { PlgAudienceFilters, PlgAudiencePage } from './plg';

export const audienceFilterScan = { maxPages: 160, budgetMs: 90_000 } as const;

/** A filtered source page can be empty even when later pages have matches. */
export async function findAudiencePage(
  load: (filters: PlgAudienceFilters, signal: AbortSignal) => Promise<PlgAudiencePage>,
  filters: PlgAudienceFilters,
  signal: AbortSignal,
  progress: (scanned: number, page: PlgAudiencePage) => void = () => {},
  clock: () => number = Date.now,
  options = { maxPages: 6, budgetMs: 20_000 },
) {
  if (!Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 160 ||
    !Number.isFinite(options.budgetMs) || options.budgetMs < 1 || options.budgetMs > 90_000)
    throw new Error('Invalid people search budget.');
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
    if (page.nextCursor && (cursors.has(page.nextCursor) || page.nextCursor === cursor))
      throw new Error('The people directory did not advance. Refresh and try again.');
    progress(scanned, page);
    if (page.rows.length || !page.nextCursor || pages >= options.maxPages || clock() - started >= options.budgetMs ||
      (filters.segment === 'all' && !filters.query.trim())) return { page, scanned, pages };
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
