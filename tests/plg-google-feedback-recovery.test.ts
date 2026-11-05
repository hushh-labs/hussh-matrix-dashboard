import { describe, expect, it, vi } from 'vitest';
import { emptyMailControl, type MailControl, type MailControlStore } from '../src/server/plg/google-mail-store';
import { GmailReadError, reconcileGoogleFeedback, type GmailRead } from '../src/server/plg/google-mail-reconcile';
import { MemoryPlgStore } from '../src/server/plg/store';

class Control implements MailControlStore {
  state = emptyMailControl();
  async read() { return structuredClone(this.state); }
  async transaction<T>(change: (state: MailControl) => T): Promise<T> {
    const draft = structuredClone(this.state), value = change(draft);
    this.state = draft; return value;
  }
}
const now = () => Date.parse('2026-11-05T18:00:00Z');
function setup() {
  const control = new Control();
  control.state.connection = { generation: 2, version: '1', connectedAt: now() - 86400000, feedbackAllowed: true };
  control.state.feedback = { cursor: '100', checkedAt: 1,
    pending: { ids: ['deleted', 'retained'], nextPage: null, upper: '150' } };
  return { control, campaigns: new MemoryPlgStore() };
}

describe('Deleted Gmail history message recovery', () => {
  it('holds sending through retained-mail recovery and catch-up without inventing a delivery outcome', async () => {
    const { control, campaigns } = setup();
    const before = await campaigns.read();
    const api = vi.fn<GmailRead>(async path => {
      if (path.startsWith('messages/deleted?')) throw new GmailReadError(404);
      if (path.startsWith('messages/retained?')) return { id: 'retained', payload: { headers: [] } };
      if (path === 'profile') return { historyId: '200' };
      if (path.startsWith('messages?')) return { messages: [{ id: 'retained' }] };
      if (path.startsWith('history?startHistoryId=200')) return { historyId: '250', history: [] };
      throw new Error('Unexpected read');
    });
    expect(await reconcileGoogleFeedback(control, campaigns, api, now() + 45000, now)).toEqual({ complete: false, inspected: 0 });
    expect(control.state.feedback).toMatchObject({ cursor: '100', checkedAt: null,
      recovery: { upper: '200', after: Math.floor(now() / 1000) - 86400 },
      unavailableReads: { count: 1, lastObservedAt: now() } });
    expect(control.state.feedback?.pending).toBeUndefined();
    expect(await reconcileGoogleFeedback(control, campaigns, api, now() + 45000, now)).toEqual({ complete: false, inspected: 1 });
    expect(control.state.feedback).toMatchObject({ cursor: '200', checkedAt: null });
    expect(await reconcileGoogleFeedback(control, campaigns, api, now() + 45000, now)).toEqual({ complete: true, inspected: 0 });
    expect(control.state.feedback).toMatchObject({ cursor: '250', checkedAt: now(), unavailableReads: { count: 1 } });
    expect((await campaigns.read()).deliveries).toEqual(before.deliveries);
    expect(api.mock.calls.filter(([path]) => path.startsWith('messages/deleted?'))).toHaveLength(1);
    expect(control.state.feedbackLease).toBeUndefined();
  });

  it.each([401, 403, 429, 500])('keeps the pending checkpoint on HTTP %i even when another message is gone', async status => {
    const { control, campaigns } = setup();
    const before = structuredClone(control.state.feedback);
    const api = vi.fn<GmailRead>(async path => {
      throw new GmailReadError(path.startsWith('messages/deleted?') ? 404 : status);
    });
    await expect(reconcileGoogleFeedback(control, campaigns, api, now() + 45000, now)).rejects.toThrow('incomplete');
    expect(control.state.feedback).toEqual(before);
    expect(api.mock.calls.some(([path]) => path === 'profile')).toBe(false);
    expect(control.state.feedbackLease).toBeUndefined();
  });
});

