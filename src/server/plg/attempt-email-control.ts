import { PlgError } from './engine';
import type { AttemptAcknowledgement, AttemptEnvironment } from './attempt-email-source';
import type { MailControl, MailControlStore } from './google-mail-store';

export class AttemptMailCycleBusy extends PlgError {
  constructor() { super(409, 'An attempt email cycle is already running.'); }
}

/** Same mailbox pacing and connection; separate lane feedback and worker lease. */
export class AttemptMailControl implements MailControlStore {
  constructor(private root: MailControlStore, readonly environment: AttemptEnvironment) {}
  private view(state: MailControl): MailControl {
    const { feedback: _feedback, feedbackLease: _lease, attemptEmail, ...common } = structuredClone(state);
    return { ...common, feedback: attemptEmail?.[this.environment]?.feedback,
      feedbackLease: attemptEmail?.[this.environment]?.feedbackLease };
  }
  async read() { return this.view(await this.root.read()); }
  async acknowledgements() {
    return structuredClone((await this.root.read()).attemptEmail?.[this.environment]?.acknowledgements ?? []);
  }
  async recordAcknowledgement(cycleId: string, receipt: AttemptAcknowledgement, now: number) {
    await this.root.transaction(state => {
      const lane = state.attemptEmail?.[this.environment];
      if (!lane || lane.cycle?.id !== cycleId || lane.cycle.until <= now)
        throw new PlgError(409, 'Attempt email cycle ownership expired.');
      lane.acknowledgements ??= [];
      const existing = lane.acknowledgements.find(a => a.id === receipt.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(receipt))
        throw new PlgError(409, 'Attempt receipt changed.');
      if (!existing) {
        if (lane.acknowledgements.length >= 20) throw new PlgError(409, 'Attempt receipts need reconciliation.');
        lane.acknowledgements.push(structuredClone(receipt));
      }
    });
  }
  async forgetAcknowledgement(receipt: AttemptAcknowledgement) {
    await this.root.transaction(state => {
      const lane = state.attemptEmail?.[this.environment];
      if (lane?.acknowledgements) lane.acknowledgements = lane.acknowledgements.filter(
        a => a.id !== receipt.id || a.claimId !== receipt.claimId);
    });
  }
  async transaction<T>(change: (state: MailControl) => T): Promise<T> {
    return this.root.transaction(state => {
      const view = this.view(state), result = change(view);
      state.attemptEmail ??= {};
      const lane = state.attemptEmail[this.environment] ??= {};
      if (view.feedback) lane.feedback = view.feedback; else delete lane.feedback;
      if (view.feedbackLease) lane.feedbackLease = view.feedbackLease; else delete lane.feedbackLease;
      const privateKeys = new Set(['feedback', 'feedbackLease', 'attemptEmail']);
      for (const key of Object.keys(state)) if (!privateKeys.has(key)) delete (state as any)[key];
      for (const [key, value] of Object.entries(view)) if (!privateKeys.has(key)) (state as any)[key] = value;
      return result;
    });
  }
  async acquire(id: string, now: number) {
    await this.root.transaction(state => {
      state.attemptEmail ??= {};
      const lane = state.attemptEmail[this.environment] ??= {};
      if (lane.cycle && lane.cycle.until > now) throw new AttemptMailCycleBusy();
      lane.cycle = { id, until: now + 240_000 };
    });
  }
  async assertLease(id: string, now: number) {
    const cycle = (await this.root.read()).attemptEmail?.[this.environment]?.cycle;
    if (cycle?.id !== id || cycle.until <= now) throw new PlgError(409, 'Attempt email cycle ownership expired.');
  }
  async finish(id: string, summary: { finishedAt: number; accepted: number; uncertain: number; deferred: boolean; status: 'completed' | 'blocked' | 'failed' }) {
    await this.root.transaction(state => {
      const lane = state.attemptEmail?.[this.environment];
      if (lane?.cycle?.id !== id) throw new PlgError(409, 'Attempt email cycle ownership changed.');
      delete lane.cycle; lane.lastCycle = summary;
    });
  }
}
