/** A missing daily source row does not establish that the day had zero activity. */
export function buildSearchConsoleDailyRows<T extends Record<string, unknown>>(
  dates: string[], rows: Record<string, unknown>[], metric: (row: Record<string, unknown>) => T,
) {
  const byDate = new Map(rows.map(row => [String(row.date ?? row.dataDate ?? row.eventDate), row]));
  return dates.map(date => {
    const row = byDate.get(date);
    if (!row) return { date, label: date.slice(5), clicks: null, impressions: null, ctr: null, averagePosition: null };
    return { date, label: date.slice(5), ...metric(row),
      ...(row.clicks == null ? { clicks: null } : {}), ...(row.impressions == null ? { impressions: null } : {}) };
  });
}

export function searchConsoleCoverageNote(dates: string[], rows: Record<string, unknown>[]): string {
  const present = new Set(rows.filter(row => row.clicks != null && row.impressions != null).map(row => String(row.date ?? row.dataDate ?? row.eventDate)));
  return dates.some(date => !present.has(date))
    ? ' Some dates have no source row; their coverage is unknown and period totals may be incomplete.' : '';
}

export function aggregateSearchDays(rows: Record<string, unknown>[], requiredDays: number) {
  const missing = { clicks: null, impressions: null, ctr: null, averagePosition: null };
  if (rows.length !== requiredDays) return missing;
  const dates = rows.map(row => typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? Date.parse(`${row.date}T00:00:00Z`) : NaN);
  if (dates.some((date, index) => !Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== rows[index].date
    || (index > 0 && date - dates[index - 1] !== 86_400_000))) return missing;
  if (rows.some(row => typeof row.clicks !== 'number' || !Number.isFinite(row.clicks) || row.clicks < 0
    || typeof row.impressions !== 'number' || !Number.isFinite(row.impressions) || row.impressions < 0)) return missing;
  const clicks = rows.reduce((sum, row) => sum + (row.clicks as number), 0);
  const impressions = rows.reduce((sum, row) => sum + (row.impressions as number), 0);
  const validPosition = rows.every(row => row.impressions === 0 || (typeof row.averagePosition === 'number' && Number.isFinite(row.averagePosition)));
  const weightedPosition = validPosition ? rows.reduce((sum, row) => sum + ((row.averagePosition as number | null) ?? 0) * (row.impressions as number), 0) : null;
  return { clicks, impressions, ctr: impressions > 0 ? clicks / impressions : null,
    averagePosition: impressions > 0 && weightedPosition !== null ? weightedPosition / impressions : null };
}
