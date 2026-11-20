import { digest, ReportError, reportDefinitions, reportingCalendarDay, reportingTimezone, type ReportId, type ReportRequest } from './contracts';

/** No policy is seeded by code. These are structural bounds, not approved operating limits. */
export type PeriodicPolicy = { approved: boolean; enabled: boolean; revision: number; slots: number[]; windowMs: number;
  maxDailyJobs: number; entries: Array<{ id: string; reportId: ReportId; timezone: string; periodDays: number; endLagDays: number }> };
export type PeriodicPlan = { day: string; slot: number; slotKey: string; receiptId: string; policyDigest: string; request: ReportRequest;
  maxDailyJobs: number; maxDailySlots: number };

/** Fixed, server-side manifest and UTC trigger windows. The source reporting
 * calendar supplies dates; the collector still validates source freshness. */
export function periodicPlan(raw: unknown, entryId: string, now: number): PeriodicPlan {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof entryId !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(entryId)
    || !Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) throw new ReportError('unavailable');
  const p = raw as PeriodicPolicy;
  if (Object.keys(p).sort().join() !== 'approved,enabled,entries,maxDailyJobs,revision,slots,windowMs'
    || p.approved !== true || p.enabled !== true || !Number.isSafeInteger(p.revision) || p.revision < 1
    || !Array.isArray(p.slots) || p.slots.length < 1 || p.slots.length > 3 || p.slots.some((slot, i) => !Number.isSafeInteger(slot) || slot < 0 || slot >= 1440 || (i > 0 && slot <= p.slots[i - 1]))
    || !Number.isSafeInteger(p.windowMs) || p.windowMs < 1 || p.windowMs > 3_600_000
    || p.slots.some((slot, i) => slot * 60_000 + p.windowMs > (p.slots[i + 1] ?? 1440) * 60_000)
    || !Array.isArray(p.entries) || p.entries.length < 1 || p.entries.length > 4 || new Set(p.entries.map(e => e?.id)).size !== p.entries.length
    || !Number.isSafeInteger(p.maxDailyJobs) || p.maxDailyJobs < 1 || p.maxDailyJobs > p.slots.length * p.entries.length) throw new ReportError('unavailable');
  for (const entry of p.entries) {
    if (!entry || Object.keys(entry).sort().join() !== 'endLagDays,id,periodDays,reportId,timezone'
      || !/^[a-z][a-z0-9-]{0,31}$/.test(entry.id) || !Object.hasOwn(reportDefinitions, entry.reportId)
      || !Number.isSafeInteger(entry.periodDays) || entry.periodDays < 1 || entry.periodDays > 90
      || !Number.isSafeInteger(entry.endLagDays) || entry.endLagDays < 0 || entry.endLagDays > 7
      || reportingTimezone(entry.timezone) !== entry.timezone) throw new ReportError('unavailable');
  }
  const entry = p.entries.find(e => e.id === entryId); if (!entry) throw new ReportError('unavailable');
  const day = new Date(now).toISOString().slice(0, 10), midnight = Date.parse(day), elapsed = now - midnight;
  const slot = p.slots.find(value => elapsed >= value * 60_000 && elapsed < value * 60_000 + p.windowMs);
  if (slot === undefined) throw new ReportError('unavailable');
  const localDay = reportingCalendarDay(entry.timezone, now);
  const end = Date.parse(localDay) - entry.endLagDays * 86_400_000, start = end - (entry.periodDays - 1) * 86_400_000;
  const request: ReportRequest = { reportId: entry.reportId, startDate: new Date(start).toISOString().slice(0, 10),
    endDate: new Date(end).toISOString().slice(0, 10), timezone: entry.timezone };
  const slotKey = `${day}:${slot}`;
  return { day, slot, slotKey, receiptId: digest([day, slot, entry.id]), policyDigest: digest(p), request,
    maxDailyJobs: p.maxDailyJobs, maxDailySlots: p.slots.length };
}
