/** A rolling provider response cannot be presented as a different historical range. */
export function hushhTechWindowMatches(summary, range) {
  return summary?.window?.startDate === range.startDate
    && summary?.window?.endDate === range.endDate;
}

/** Selected-range totals do not establish an independent 1-day or 7-day total. */
export function hushhTechPeriodValue(summary, value, days) {
  const window = summary?.window;
  if (!Number.isSafeInteger(days) || days < 1 || !window) return null;
  const parse = (date) => {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
    const instant = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === date ? instant : NaN;
  };
  const count = (parse(window.endDate) - parse(window.startDate)) / 86_400_000 + 1;
  return count === days && window.days === days ? value ?? null : null;
}
