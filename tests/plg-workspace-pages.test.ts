import { describe, expect, it } from 'vitest';
import type { PlgWorkspace } from '../src/lib/plg';
import { initialPlgState, metrics } from '../src/server/plg/engine';
import { decodeWorkspacePage, encodeWorkspacePages } from '../src/server/plg/workspace-pages';

const NOW = Date.parse('2026-10-29T00:00:00Z'), secret = 'test-only-page-key-more-than-thirty-two-characters';
const generation = 'a'.repeat(64), actor = 'operator@example.invalid';
function workspace(): PlgWorkspace {
  const state = initialPlgState(), totals = metrics(state, NOW);
  state.storage = { mode: 'accounts', generation, report: { asOf: new Date(NOW).toISOString(), metrics: totals,
    reporting: { pending: 0, excluded: 0 }, eligible: 0, blockedReasons: [], cohorts: [],
    activity: { connectedAccounts: 0, agents: [] }, contacts: { nextAfter: 'b'.repeat(64), matches: 1001, checked: 1001 },
    history: { nextAfter: { createdAt: new Date(NOW).toISOString(), id: 'synthetic-receipt' }, emails: {} } } };
  return { state, role: 'operator', configured: true, deliveryEnabled: false, queue: [], metrics: totals };
}
describe('private campaign continuations', () => {
  it('keeps queue filters, global counts and independently paged history bound to one storage generation', () => {
    const query = { query: 'match', filter: 'assistance' as const }, result = encodeWorkspacePages(workspace(), query, actor, secret, NOW);
    expect(result.pages?.contacts).toMatchObject({ matches: 1001, checked: 1001 });
    const queueCursor = result.pages!.contacts.next, historyCursor = result.pages!.history.next;
    expect(decodeWorkspacePage({ ...query, queueCursor, historyCursor }, actor, secret, NOW + 1)).toMatchObject({
      ...query, generation, after: 'b'.repeat(64), historyAfter: { createdAt: new Date(NOW).toISOString(), id: 'synthetic-receipt' },
    });
    // Queue filtering does not invalidate an independently selected history page.
    expect(decodeWorkspacePage({ query: 'other', historyCursor }, actor, secret, NOW + 1).historyAfter?.id).toBe('synthetic-receipt');
  });
  it('rejects changed filters, foreign operators, tampering, expiry and mixed storage generations', () => {
    const result = encodeWorkspacePages(workspace(), { query: 'match' }, actor, secret, NOW), queueCursor = result.pages!.contacts.next!;
    for (const body of [{ query: 'changed', queueCursor }, { query: 'match', queueCursor: queueCursor + 'x' },
      { query: 'match', historyCursor: queueCursor }, { after: 'b'.repeat(64) }, { query: 'match', queueCursor, ignored: true }])
      expect(() => decodeWorkspacePage(body, actor, secret, NOW + 1)).toThrow();
    expect(() => decodeWorkspacePage({ query: 'match', queueCursor }, 'another@example.invalid', secret, NOW + 1)).toThrow();
    expect(() => decodeWorkspacePage({ query: 'match', queueCursor }, actor, secret, NOW + 30 * 60_000)).toThrow();
    const other = workspace(); other.state.storage!.generation = 'c'.repeat(64);
    const historyCursor = encodeWorkspacePages(other, {}, actor, secret, NOW).pages!.history.next;
    expect(() => decodeWorkspacePage({ query: 'match', queueCursor, historyCursor }, actor, secret, NOW + 1)).toThrow();
  });
  it('requires signing only for actual account-mode continuations and leaves legacy reads unchanged', () => {
    const legacy = workspace(); delete legacy.state.storage;
    expect(encodeWorkspacePages(legacy, {}, actor, '', NOW)).toBe(legacy);
    expect(() => encodeWorkspacePages(workspace(), {}, actor, '', NOW)).toThrow('signing');
    expect(() => decodeWorkspacePage({ query: 'x'.repeat(101) }, actor, secret, NOW)).toThrow('Invalid campaign');
  });
});
