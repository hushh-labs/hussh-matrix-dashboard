/** Bounded per-account working state over permanent delivery and dedup records. */
import { createHash } from 'node:crypto';
import type { PlgContact, PlgDelivery, PlgState, PlgStep } from '../../lib/plg';
import { plgSteps } from '../../lib/plg';
import { accountHash, initialPlgState, PlgError } from './engine';

export const ACCOUNT_BYTES = 750_000;
export const RECENT_DELIVERIES = 50;
export const RECENT_KEYS = 50;
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const canonical = (value: any): string => value === undefined ? 'undefined' : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` :
  value && typeof value === 'object' ? `{${Object.keys(value).filter(key => value[key] !== undefined).sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
export const stableHash = (value: unknown) => digest(canonical(value));
export const accountFields = ['contacts', 'deliveries', 'eventIds', 'erasedAccountHashes',
  'pendingRevocations', 'subscriptionVersions'] as const;
export interface AccountPolicy {
  unresolvedIds: string[];
  latestPromotions: { id: string; at: string }[];
  latestStepAt: Partial<Record<PlgStep, string>>;
  latestReturnAt: string | null;
  claimedKeys: string[];
}
export interface AccountRecord {
  schema: 2;
  revision: number;
  payload: string;
  contact: PlgContact | null;
  policy: AccountPolicy;
  cleanupPending?: boolean;
  preReservationPolicy?: { deliveryId: string; policy: AccountPolicy };
}
export const accountProjectionHash = (record: Pick<AccountRecord, 'contact' | 'policy'>) =>
  stableHash([record.contact, record.policy]);
export { validatePolicy as validateAccountPolicy };
const emptyPolicy = (): AccountPolicy => ({ unresolvedIds: [], latestPromotions: [],
  latestStepAt: {}, latestReturnAt: null, claimedKeys: [] });
const stamp = (value: unknown): value is string => typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const strings = (value: unknown, limit: number): value is string[] => Array.isArray(value) && value.length <= limit &&
  value.every(item => typeof item === 'string' && item.length > 0 && item.length <= 4096) && new Set(value).size === value.length;
function validatePolicy(value: AccountPolicy) {
  if (!value || !strings(value.unresolvedIds, 50) || !strings(value.claimedKeys, RECENT_KEYS) ||
    !Array.isArray(value.latestPromotions) || value.latestPromotions.length > 3 ||
    value.latestPromotions.some(item => !item || typeof item.id !== 'string' || !stamp(item.at)) ||
    new Set(value.latestPromotions.map(item => item.id)).size !== value.latestPromotions.length ||
    !value.latestStepAt || typeof value.latestStepAt !== 'object' || Array.isArray(value.latestStepAt) ||
    Object.entries(value.latestStepAt).some(([key, at]) => !plgSteps.includes(key as PlgStep) || !stamp(at)) ||
    (value.latestReturnAt !== null && !stamp(value.latestReturnAt)))
    throw new PlgError(503, 'Account policy did not confirm its shape.');
}
export function settings(state: PlgState): Omit<PlgState, typeof accountFields[number]> {
  const result = { ...state };
  for (const field of accountFields) delete (result as any)[field];
  delete result.storage;
  delete result.deliveryPolicies;
  return result;
}
export function projectPolicy(policy: AccountPolicy, contact: PlgContact) {
  return { unresolved: policy.unresolvedIds.length > 0,
    latestPromotions: policy.latestPromotions.map(item => item.at),
    latestStepAt: policy.latestStepAt,
    lastReturnAt: policy.latestReturnAt && Date.parse(policy.latestReturnAt) >= Date.parse(contact.lastValueAt ?? '')
      ? policy.latestReturnAt : null,
    claimedKeys: policy.claimedKeys };
}
export function hydrateAccount(base: ReturnType<typeof settings>, record?: AccountRecord): PlgState {
  if (record && (record.schema !== 2 || !Number.isSafeInteger(record.revision) || record.revision < 1 ||
    typeof record.payload !== 'string' || Buffer.byteLength(JSON.stringify(record)) > ACCOUNT_BYTES))
    throw new PlgError(503, 'Account storage did not confirm its shape.');
  if (record) {
    validatePolicy(record.policy);
    if (record.preReservationPolicy) validatePolicy(record.preReservationPolicy.policy);
  }
  let local: PlgState;
  try { local = record ? JSON.parse(record.payload) : initialPlgState(); }
  catch { throw new PlgError(503, 'Account storage did not confirm its shape.'); }
  if (!local || !Array.isArray(local.contacts) || !Array.isArray(local.deliveries) || !Array.isArray(local.eventIds))
    throw new PlgError(503, 'Account storage did not confirm its shape.');
  const state: PlgState = { ...base, ...Object.fromEntries(accountFields.map(key => [key, local[key]])),
    ...(!base.customerReporting && local.customerReporting ? { customerReporting: local.customerReporting } : {}),
    audit: record ? local.audit ?? [] : base.audit, storage: { mode: 'accounts' }, contacts: local.contacts,
    deliveries: local.deliveries, eventIds: local.eventIds };
  if (record && stableHash(record.contact) !== stableHash(state.contacts[0] ?? null))
    throw new PlgError(503, 'Account projection parity did not confirm success.');
  if (state.contacts[0]) state.deliveryPolicies = {
    [state.contacts[0].id]: projectPolicy(record?.policy ?? emptyPolicy(), state.contacts[0]),
  };
  return state;
}
export function updatePolicy(previous: AccountPolicy, deliveries: PlgDelivery[]): AccountPolicy {
  const result = structuredClone(previous), unresolved = new Set(result.unresolvedIds);
  const promotions = new Map(result.latestPromotions.map(item => [item.id, item.at]));
  for (const delivery of deliveries) {
    if (['sending', 'uncertain'].includes(delivery.status)) unresolved.add(delivery.id);
    else unresolved.delete(delivery.id);
    promotions.set(delivery.id, delivery.createdAt);
    if (delivery.step !== 'manual' && (!result.latestStepAt[delivery.step] ||
      delivery.createdAt > result.latestStepAt[delivery.step]!)) result.latestStepAt[delivery.step] = delivery.createdAt;
    if (delivery.step === 'return' && (!result.latestReturnAt || delivery.createdAt > result.latestReturnAt))
      result.latestReturnAt = delivery.createdAt;
    result.claimedKeys.push(delivery.key);
  }
  result.unresolvedIds = [...unresolved];
  result.latestPromotions = [...promotions].map(([id, at]) => ({ id, at }))
    .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)).slice(0, 3);
  result.claimedKeys = [...new Set(result.claimedKeys)].slice(-RECENT_DELIVERIES);
  return result;
}
export function sealAccount(state: PlgState, hash: string, previous?: AccountRecord) {
  if (!/^[a-f0-9]{64}$/.test(hash) || state.contacts.length > 1 ||
    state.contacts.some(contact => accountHash(contact.accountId) !== hash) ||
    state.deliveries.some(delivery => delivery.contactId !== state.contacts[0]?.id) ||
    new Set(state.deliveries.map(delivery => delivery.id)).size !== state.deliveries.length ||
    state.erasedAccountHashes?.some(value => value !== hash) ||
    state.pendingRevocations?.some(value => value.accountHash !== `sha256:${hash}`) ||
    Object.keys(state.subscriptionVersions ?? {}).some(value => value !== hash))
    throw new PlgError(409, 'Account storage scope changed; no write was applied.');
  const prior = structuredClone(previous?.policy ?? emptyPolicy());
  const recorded = state.contacts[0] && state.deliveryPolicies?.[state.contacts[0].id];
  if (recorded) prior.claimedKeys.push(...recorded.claimedKeys);
  const policy = state.contacts.length ? updatePolicy(prior, state.deliveries) : emptyPolicy();
  validatePolicy(policy);
  const unresolved = state.deliveries.filter(delivery => ['sending', 'uncertain'].includes(delivery.status));
  const recent = state.deliveries.filter(delivery => !['sending', 'uncertain'].includes(delivery.status))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    .slice(0, RECENT_DELIVERIES).reverse();
  const local = { ...Object.fromEntries(accountFields.map(key => [key, state[key]])),
    contacts: state.contacts, deliveries: [...recent, ...unresolved],
    eventIds: state.eventIds.slice(-RECENT_KEYS), audit: state.audit,
    ...(state.customerReporting ? { customerReporting: state.customerReporting } : {}) };
  const record: AccountRecord = { schema: 2, revision: (previous?.revision ?? 0) + 1,
    payload: JSON.stringify(local), contact: state.contacts[0] ?? null, policy };
  if (!Number.isSafeInteger(record.revision) || Buffer.byteLength(JSON.stringify(record)) > ACCOUNT_BYTES)
    throw new PlgError(409, 'This account exceeds its safe record budget; no history was discarded.');
  // The writer must atomically retain these permanent records before publishing
  // the bounded working set. No history or deduplication fact may be discarded.
  return { record, receipts: state.deliveries, keys: state.eventIds };
}
