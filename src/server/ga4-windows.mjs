/** GA4 includes both endpoints; N days back through today covers N + 1 dates. */
export function ga4RecentCalendarRange(days) {
  if (!Number.isSafeInteger(days) || days < 1 || days > 90) throw new Error('Invalid GA4 calendar window');
  return { startDate: days === 1 ? 'today' : `${days - 1}daysAgo`, endDate: 'today' };
}
