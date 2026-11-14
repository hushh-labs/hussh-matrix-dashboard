import { SourceRequestFailure } from './source-errors';
import { reportPath, type ReportTransaction } from './store';
import type { SourceBudgetReservation } from './sources';

type Budget = { used: number; limit: number };
type ReadAllowance = { policy: 'one-read-budget' | 'ga4-read-budget' | 'website-read-budget' | 'monitoring-read-budget';
  identity: string; units: number };
function invalid(): never { throw new SourceRequestFailure('configuration'); }

/** Server-chosen source identity only. Reserve with the journal, before I/O.
 * This limits requests/read units, not currency or upstream work per request. */
export async function dailySourceReadBudget(tx: ReportTransaction, allowance: ReadAllowance,
  now: number): Promise<SourceBudgetReservation> {
  const field = allowance.policy === 'website-read-budget' ? 'dailyReadUnits' : 'dailyQueries';
  const ceiling = field === 'dailyReadUnits' ? Number.MAX_SAFE_INTEGER : 1000;
  if (!/^[a-z0-9-]{1,160}$/.test(allowance.identity) || !Number.isSafeInteger(allowance.units)
    || allowance.units <= 0 || !Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) return invalid();
  const policy = await tx.get<Record<string, unknown>>(reportPath('policy', allowance.policy));
  if (!policy || Object.keys(policy).sort().join() !== ['approved', field].sort().join() || policy.approved !== true
    || !Number.isSafeInteger(policy[field]) || Number(policy[field]) < 1 || Number(policy[field]) > ceiling) return invalid();
  const day = new Date(now).toISOString().slice(0, 10);
  const ref = reportPath('sourceReadBudgets', `${allowance.identity}-${day}`);
  const previous = await tx.get<Budget>(ref);
  if (previous && (Object.keys(previous).sort().join() !== 'limit,used' || !Number.isSafeInteger(previous.used)
    || !Number.isSafeInteger(previous.limit) || previous.used < 0 || previous.limit < 1)) return invalid();
  const used = previous?.used ?? 0, limit = Math.min(previous?.limit ?? Number(policy[field]), Number(policy[field]));
  if (allowance.units > limit - used) return Object.assign(() => {
    // Preserve a newly observed tighter cap on refusal, without repeatedly
    // rewriting an unchanged exhausted ledger on every bounded redelivery.
    if (previous?.limit !== limit) tx.set(ref, { used, limit });
  }, { rejection: new SourceRequestFailure('quota', Date.parse(day) + 86_400_000 - now) });
  return () => tx.set(ref, { used: used + allowance.units, limit });
}
