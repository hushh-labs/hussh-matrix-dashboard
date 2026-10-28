/** Bounded projections and global reductions; account payload/history is never scanned. */
import { FieldPath, type Firestore, type Timestamp, type Transaction } from '@google-cloud/firestore';
import type { PlgAccountReport, PlgCandidate, PlgContact, PlgState } from '../../lib/plg';
import { accountHash, candidate, customerReportingCurrent, customerReportingEligible, metrics, PlgError } from './engine';
import { accountProjectionHash, digest, hydrateAccount, projectPolicy, settings, stableHash,
  validateAccountPolicy, type AccountRecord } from './account-state';

export interface AccountReportQuery {
  generation?: string;
  after?: string | null;
  historyAfter?: { createdAt: string; id: string } | null;
  query?: string;
  filter?: 'all' | 'assistance' | 'due' | 'unknown';
  contactId?: string | null;
}
interface Context { base: ReturnType<typeof settings>; mailFence: { pending: number }; readTime: Timestamp }
const PAGE = 25, SCAN = 100, BUDGET = 20_000, MAX_PAGES = 256;
const fail = (message = 'Campaign reporting did not confirm success.'): never => { throw new PlgError(503, message); };
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(value);
const policyHash = (base: Context['base']) => stableHash([base.paused, base.ready, base.catalog,
  base.templates, base.customerReporting, base.automation?.enabled]);
export function validateAccountReportQuery(query: AccountReportQuery) {
  if (!query || typeof query !== 'object' || Array.isArray(query) ||
    Object.keys(query).some(key => !['generation', 'after', 'historyAfter', 'query', 'filter', 'contactId'].includes(key)) ||
    query.generation !== undefined && !hash(query.generation) ||
    query.after != null && !hash(query.after) || query.contactId != null && !id(query.contactId) ||
    query.query !== undefined && (typeof query.query !== 'string' || query.query.length > 100) ||
    query.filter !== undefined && !['all', 'assistance', 'due', 'unknown'].includes(query.filter) ||
    query.historyAfter != null && (!id(query.historyAfter.id) ||
      typeof query.historyAfter.createdAt !== 'string' || !Number.isFinite(Date.parse(query.historyAfter.createdAt)) ||
      new Date(query.historyAfter.createdAt).toISOString() !== query.historyAfter.createdAt))
    throw new PlgError(400, 'Invalid campaign page.');
}
function contactOf(record: Pick<AccountRecord, 'contact' | 'policy'>, docId: string, projection: unknown) {
  if (!record.contact || projection !== accountProjectionHash(record) || accountHash(record.contact.accountId) !== docId)
    fail('Campaign identity projection did not confirm success.');
  validateAccountPolicy(record.policy);
  return record.contact!;
}
function localState(base: Context['base'], record: Pick<AccountRecord, 'contact' | 'policy'>) {
  const state = hydrateAccount(base), contact = record.contact!;
  state.contacts = [contact]; state.deliveryPolicies = { [contact.id]: projectPolicy(record.policy, contact) };
  return state;
}
function matches(contact: PlgContact, query: AccountReportQuery, decision: PlgCandidate) {
  if (query.contactId && contact.id !== query.contactId) return false;
  if (!`${contact.name} ${contact.email} ${contact.owner}`.toLowerCase().includes((query.query ?? '').toLowerCase())) return false;
  return !query.filter || query.filter === 'all' || query.filter === 'due' && decision.eligible ||
    query.filter === 'assistance' && decision.stage === 'blocked' || query.filter === 'unknown' && decision.stage === 'unknown';
}

export async function readAccountReport(db: Firestore, generation: string,
  context: (tx: Transaction) => Promise<Context>, query: AccountReportQuery = {}, now = Date.now()): Promise<PlgState> {
  validateAccountReportQuery(query);
  if (query.generation && query.generation !== generation) throw new PlgError(409, 'Campaign storage changed; restart this view.');
  const started = Date.now(), initial = await db.runTransaction(context, { readOnly: true });
  const { base, readTime } = initial, root = `one_plg_generations/${generation}`;
  const state = hydrateAccount(base), summary: PlgAccountReport = {
    asOf: readTime.toDate().toISOString(), metrics: metrics(state, now), reporting: { pending: 0, excluded: 0 },
    eligible: 0, blockedReasons: [], cohorts: [], contacts: { nextAfter: null, matches: 0, checked: 0 },
    activity: { connectedAccounts: 0, agents: [] },
    history: { nextAfter: null, emails: {} },
  };
  const cohorts = new Map<string, PlgAccountReport['cohorts'][number]>(), reasons = new Map<string, number>();
  const activity = new Map<string, PlgAccountReport['activity']['agents'][number]>();
  let cursor: string | null = null, pages = 0, total = 0, selectedLast: string | null = null;
  const guard = () => { if (Date.now() - started > BUDGET) fail('Campaign reporting exceeded its read budget; refresh to retry.'); };
  while (true) {
    guard();
    if (++pages > MAX_PAGES) fail('Campaign reporting exceeded its bounded scan; totals are withheld.');
    let request = db.collection(`${root}/one_plg_accounts`).where('enrolled', '==', true)
      .orderBy(FieldPath.documentId()).select('contact', 'policy', 'projectionHash').limit(SCAN);
    if (cursor) request = request.startAfter(cursor);
    const batch = await db.runTransaction(async tx => {
      const result = await tx.get(request);
      const rows = result.docs.map(doc => {
        const record = doc.data() as AccountRecord, contact = contactOf(record, doc.id, doc.get('projectionHash'));
        const local = localState(base, record), decision = candidate(local, contact, now);
        return { hash: doc.id, record, contact, local, decision };
      });
      const due = rows.filter(row => row.decision.eligible && row.decision.key);
      const keys = due.length ? await tx.getAll(...due.map(row => db.doc(`${root}/one_plg_keys/${digest('delivery\n' + row.decision.key)}`)), { fieldMask: ['seen'] }) : [];
      for (let n = 0; n < due.length; n++) if (keys[n].exists) {
        if (keys[n].get('seen') !== true) fail('Campaign reservation proof did not confirm success.');
        due[n].decision = { ...due[n].decision, eligible: false, reason: 'This journey step has already been reserved or sent' };
        due[n].local.deliveryPolicies![due[n].contact.id].claimedKeys.push(due[n].decision.key!);
      }
      return rows;
    }, { readOnly: true, readTime });
    guard();
    for (const row of batch) {
      total++; summary.contacts.checked++;
      if (!customerReportingCurrent(state, row.contact, now)) summary.reporting.pending++;
      else if (!customerReportingEligible(state, row.contact, now)) summary.reporting.excluded++;
      if (!customerReportingEligible(state, row.contact, now)) continue;
      if (row.contact.activity?.enabled && row.contact.activity.epoch) summary.activity.connectedAccounts++;
      for (const observed of row.contact.activity?.agents ?? []) {
        const aggregate = activity.get(observed.agentId) ?? { agentId: observed.agentId, observedAccounts: 0, executed: 0, reported: 0, failed: 0 };
        aggregate.observedAccounts++; aggregate.executed += observed.executed;
        aggregate.reported += observed.reported; aggregate.failed += observed.failed;
        activity.set(observed.agentId, aggregate);
      }
      const one = metrics(row.local, now);
      for (const key of Object.keys(summary.metrics) as (keyof PlgAccountReport['metrics'])[]) summary.metrics[key] += one[key];
      const cohortKey = `${row.contact.cohort}:${row.contact.group}`;
      const cohort = cohorts.get(cohortKey) ?? { cohort: row.contact.cohort, group: row.contact.group, enrolled: 0, activated: 0, repeat: 0 };
      cohort.enrolled++; cohort.activated += Number(Boolean(row.contact.firstValueAt)); cohort.repeat += Number(row.contact.valueDays.length > 1);
      cohorts.set(cohortKey, cohort);
      if (row.decision.eligible) summary.eligible++;
      else reasons.set(row.decision.reason, (reasons.get(row.decision.reason) ?? 0) + 1);
      if (!matches(row.contact, query, row.decision)) continue;
      summary.contacts.matches++;
      if (query.after && row.hash <= query.after) continue;
      if (state.contacts.length === PAGE) { summary.contacts.nextAfter ??= selectedLast; continue; }
      state.contacts.push(row.contact); selectedLast = row.hash;
      state.deliveryPolicies ??= {};
      state.deliveryPolicies[row.contact.id] = row.local.deliveryPolicies![row.contact.id];
    }
    if (batch.length < SCAN) break;
    cursor = batch.at(-1)!.hash;
  }
  summary.cohorts = [...cohorts.values()]; summary.activity.agents = [...activity.values()];
  summary.blockedReasons = [...reasons].map(([reason, accounts]) => ({ reason, accounts }));
  // History is independently paged. Staff/excluded or erased recipients never
  // become public rows merely because their account is outside the queue page.
  let after = query.historyAfter ?? null, historyPages = 0;
  while (state.deliveries.length <= PAGE) {
    guard(); if (++historyPages > MAX_PAGES) fail('Delivery history exceeded its bounded scan; continuation is unavailable.');
    let request = db.collection(`${root}/one_plg_receipts`).orderBy('delivery.createdAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc').limit(PAGE);
    if (after) request = request.startAfter(after.createdAt, after.id);
    const rows = await db.runTransaction(async tx => {
      const receipts = await tx.get(request);
      const hashes = [...new Set(receipts.docs.map(doc => doc.get('accountHash')))];
      if (hashes.some(value => !hash(value))) fail('Delivery history owner did not confirm success.');
      const owners = hashes.length ? await tx.getAll(...hashes.map(value => db.doc(`${root}/one_plg_accounts/${value}`)),
        { fieldMask: ['contact', 'policy', 'projectionHash'] }) : [];
      return receipts.docs.map(doc => {
        const delivery = doc.get('delivery') as PlgState['deliveries'][number];
        const owner = owners.find(value => value.id === doc.get('accountHash'));
        if (!delivery || delivery.id !== doc.id || typeof delivery.createdAt !== 'string' || !Number.isFinite(Date.parse(delivery.createdAt))) fail();
        if (!owner?.exists || !owner.get('contact')) return { delivery, contact: null };
        const contact = contactOf(owner.data() as AccountRecord, owner.id, owner.get('projectionHash'));
        if (delivery.contactId !== contact.id) fail('Delivery history recipient did not confirm success.');
        return { delivery, contact };
      });
    }, { readOnly: true, readTime });
    for (const row of rows) {
      if (!row.contact || !customerReportingEligible(state, row.contact, now)) continue;
      if (state.deliveries.length === PAGE) {
        const previous = state.deliveries.at(-1)!;
        summary.history.nextAfter = { createdAt: previous.createdAt, id: previous.id }; break;
      }
      state.deliveries.push(row.delivery); summary.history.emails[row.contact.id] = row.contact.email;
    }
    if (summary.history.nextAfter || rows.length < PAGE) break;
    const last = rows.at(-1)!.delivery; after = { createdAt: last.createdAt, id: last.id };
  }
  guard();
  const current = await db.runTransaction(context, { readOnly: true });
  if (policyHash(current.base) !== policyHash(base)) throw new PlgError(409, 'Campaign settings changed; refresh the page.');
  state.storage = { mode: 'accounts', generation, totalContacts: total, pendingDeliveries: initial.mailFence.pending, report: summary };
  return state;
}
