/** Keep only the One selection across a same-tab sign-in. No account data is stored. */
export interface OneSelection { tab: 'one'; environment: 'production' | 'uat'; range: { preset: 1 | 7 | 14 | 30 | 90 | 'custom'; startDate: string; endDate: string } }
const key = 'metrics-one-session-selection-v1';
export function saveOneSelection(value: OneSelection) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* sign-in remains available without storage */ }
}
export function readOneSelection(): OneSelection | null {
  try {
    const raw = sessionStorage.getItem(key); if (!raw || raw.length > 300) return null;
    const value = JSON.parse(raw), range = value?.range, start = range?.startDate, end = range?.endDate;
    if (value?.tab !== 'one' || !['production', 'uat'].includes(value.environment) || ![1, 7, 14, 30, 90, 'custom'].includes(range?.preset)
      || typeof start !== 'string' || typeof end !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)
      || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || new Date(start).toISOString().slice(0, 10) !== start
      || new Date(end).toISOString().slice(0, 10) !== end || Date.parse(end) < Date.parse(start) || Date.parse(end) - Date.parse(start) > 89 * 86_400_000) return null;
    return { tab: 'one', environment: value.environment, range: { preset: range.preset, startDate: start, endDate: end } };
  } catch { return null; }
}

export function clearOneSelection() { try { sessionStorage.removeItem(key); } catch { /* optional recovery */ } }
