import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { GoogleMail, GoogleMailUnattempted } from '../src/server/plg/google-mail';
import { emptyMailControl, MAIL_OWNER, type MailControl, type MailControlStore } from '../src/server/plg/google-mail-store';

class Control implements MailControlStore {
  state = emptyMailControl();
  private pending = Promise.resolve();
  async read() { await this.pending; return structuredClone(this.state); }
  async transaction<T>(change: (state: MailControl) => T) {
    const result = this.pending.then(() => {
      const draft = structuredClone(this.state), value = change(draft);
      this.state = draft; return value;
    });
    this.pending = result.then(() => {}, () => {}); return result;
  }
}
const START = Date.parse('2026-10-29T00:00:00Z');
const message = { text: 'Synthetic pacing test', html: '<p>Synthetic</p>', headers: {} };
function fixture() {
  let now = START;
  const control = new Control();
  control.state.connection = { version: '1', generation: 1, connectedAt: now };
  const transport = vi.fn(async () => Response.json({ id: 'syntheticAccepted' }));
  const worker = () => new GoogleMail(control, { save: async () => '1', read: async () => 'synthetic' },
    { url: () => '', exchange: async () => '', access: async () => 'synthetic' }, transport, () => now);
  const send = (mail = worker(), id = randomUUID()) => mail.send(MAIL_OWNER, { id, subject: 'Synthetic' }, message);
  return { control, transport, worker, send, advance: (ms: number) => { now += ms; } };
}
describe('mailbox pacing without an application daily quota', () => {
  it('sends more than 100 distinct reservations in one rolling day', async () => {
    const f = fixture();
    for (let n = 0; n < 120; n++) { await f.send(); f.advance(60_000); }
    expect(f.transport).toHaveBeenCalledTimes(120);
    expect(f.control.state.attempts).toHaveLength(120);
    expect(await f.worker().status()).toMatchObject({ applicationDailyLimit: null });
  });
  it('shares a durable burst budget across workers and reconnects, then automatically refills', async () => {
    const f = fixture();
    const results = await Promise.allSettled(Array.from({ length: 15 }, () => f.send()));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(10);
    expect(f.transport).toHaveBeenCalledTimes(10);
    expect(await f.worker().status()).toMatchObject({ pacingRetryAt: START + 60_000 });
    await f.control.transaction(s => { s.connection = { version: '2', generation: 2, connectedAt: START }; });
    await expect(f.send()).rejects.toBeInstanceOf(GoogleMailUnattempted);
    f.advance(59_999); await expect(f.send()).rejects.toBeInstanceOf(GoogleMailUnattempted);
    f.advance(1); await f.send();
    expect(f.transport).toHaveBeenCalledTimes(11);
  });
  it('keeps rolling attempt retention bounded and preserves ambiguous reservations through cleanup', async () => {
    const f = fixture();
    for (let n = 0; n < 1_500; n++) { await f.send(); f.advance(60_000); }
    const ambiguousId = randomUUID();
    f.transport.mockRejectedValueOnce(new Error('Synthetic lost response'));
    await expect(f.send(f.worker(), ambiguousId)).rejects.toThrow('Synthetic lost response');
    f.advance(60_000); await f.send();
    await expect(f.send(f.worker(), ambiguousId)).rejects.toBeInstanceOf(GoogleMailUnattempted);
    expect(f.control.state.attempts.some(a => a.id === ambiguousId)).toBe(true);
    expect(f.control.state.attempts.length).toBeLessThanOrEqual(1_450);
    expect(Buffer.byteLength(JSON.stringify(f.control.state))).toBeLessThan(150_000);
  }, 30_000);
});
