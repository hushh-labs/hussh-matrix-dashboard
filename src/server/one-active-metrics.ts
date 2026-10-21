/** A successful aggregate needs its own evidence; another query's rows cannot validate it. */
export function oneActiveQueryAvailable(result: { error?: unknown; rows: Record<string, unknown>[] }): boolean {
  if (result.error || result.rows.length !== 1) return false;
  const row = result.rows[0];
  const fields = ['dau', 'wau', 'mau', 'dauAccounts', 'wauAccounts', 'mauAccounts',
    'dauIdentifiedDevices', 'wauIdentifiedDevices', 'mauIdentifiedDevices'] as const;
  const count = (value: unknown) => typeof value === 'number' ||
    (typeof value === 'string' && /^\d+$/.test(value)) ? Number(value) : NaN;
  if (fields.some((key) => !Number.isSafeInteger(count(row[key])) || count(row[key]) < 0)) return false;
  const asOf = row.asOf;
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
      !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString().slice(0, 10) !== asOf) return false;
  for (const suffix of ['', 'Accounts', 'IdentifiedDevices']) {
    if (count(row['dau' + suffix]) > count(row['wau' + suffix]) ||
        count(row['wau' + suffix]) > count(row['mau' + suffix])) return false;
  }
  return ['dau', 'wau', 'mau'].every((period) =>
    count(row[period + 'IdentifiedDevices']) <= count(row[period]));
}
