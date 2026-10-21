import { describe, expect, it, vi } from 'vitest';
import { findAudiencePage, outcomeCoverage } from '../src/lib/plg-audience';
import type { PlgAudienceFilters, PlgAudiencePage } from '../src/lib/plg';

const filters: PlgAudienceFilters = { agentId: 'agent_one', segment: 'failed', query: '', graceMinutes: 60 };
const page = (nextCursor: string | null, matches = false) => ({
  scanned: 25, nextCursor, rows: matches ? [{ accountId: 'synthetic-match' }] : [],
} as PlgAudiencePage);

describe('Private people directory search', () => {
  it('finds a match after empty source pages and preserves the next continuation', async () => {
    const load = vi.fn().mockResolvedValueOnce(page('second')).mockResolvedValueOnce(page('third'))
      .mockResolvedValueOnce(page('fourth', true));
    const progress = vi.fn();
    const result = await findAudiencePage(load, filters, new AbortController().signal, progress);
    expect(result).toMatchObject({ scanned: 75, pages: 3, page: { nextCursor: 'fourth', rows: [{ accountId: 'synthetic-match' }] } });
    expect(load.mock.calls.map(([input]) => input.cursor)).toEqual([null, 'second', 'third']);
    expect(progress.mock.calls.map(([count]) => count)).toEqual([25, 50, 75]);
  });

  it('does not mistake a bounded scan for the end of the directory', async () => {
    const load = vi.fn().mockImplementation(async (input) => page(String(Number(input.cursor ?? 0) + 1)));
    const result = await findAudiencePage(load, filters, new AbortController().signal);
    expect(load).toHaveBeenCalledTimes(6);
    expect(result.page.nextCursor).toBe('6');
    expect(result.scanned).toBe(150);
  });

  it('returns an exhausted search only after the source actually ends', async () => {
    const load = vi.fn().mockResolvedValueOnce(page('second')).mockResolvedValueOnce(page(null));
    const result = await findAudiencePage(load, { ...filters, query: 'specific person' }, new AbortController().signal);
    expect(result.page.nextCursor).toBeNull();
    expect(result.page.rows).toEqual([]);
    expect(result.scanned).toBe(50);
  });

  it('keeps unfiltered browsing to one source page', async () => {
    const load = vi.fn().mockResolvedValue(page('second'));
    await findAudiencePage(load, { ...filters, segment: 'all' }, new AbortController().signal);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('stops once the elapsed scan budget is reached without losing continuation', async () => {
    const load = vi.fn().mockResolvedValue(page('second'));
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValue(20_000);
    expect(await findAudiencePage(load, filters, new AbortController().signal, undefined, clock))
      .toMatchObject({ pages: 1, page: { nextCursor: 'second' } });
  });

  it('fences a result arriving after a filter change and rejects cyclic cursors', async () => {
    const abort = new AbortController();
    const late = vi.fn().mockImplementation(async () => { abort.abort(); return page(null, true); });
    await expect(findAudiencePage(late, filters, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const repeating = vi.fn().mockResolvedValue(page('same'));
    await expect(findAudiencePage(repeating, filters, new AbortController().signal)).rejects.toThrow('did not advance');
    expect(repeating).toHaveBeenCalledTimes(2);
  });

  it('reports the connected catalog coverage without inventing new backend capabilities', () => {
    const source: Pick<PlgAudiencePage, 'catalog'> = { catalog: { revision: 'a'.repeat(64), actions: [], agents: [
      { id: 'agent_email', label: 'Mail', public: true, available: true },
      { id: 'agent_calendar', label: 'Calendar', public: true, available: true },
      { id: 'agent_internal', label: 'Internal', public: false, available: true },
    ] } };
    expect(outcomeCoverage(source)).toEqual({ measured: 1, agents: 2, legacy: true });
  });
});
