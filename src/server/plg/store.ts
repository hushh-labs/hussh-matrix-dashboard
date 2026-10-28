import { mkdir, readFile, rename, writeFile, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PlgState } from '../../lib/plg';
import { initialPlgState, PlgError } from './engine';
import { PlgFirestoreStorage } from './firestore-storage';
import { AccountPlgStore, accountAuthority } from './account-store';
import { PLG_STORAGE_AUTHORITY } from './firestore-storage';
import type { AccountReportQuery } from './account-report';

export interface PlgStore {
  read(): Promise<PlgState>;
  transaction<T>(fn: (state: PlgState) => T): Promise<T>;
  accountStorage?(): Promise<AccountPlgStore | null>;
  readWithoutReservation?(deliveryId: string): Promise<PlgState>;
  readWorkspace?(query?: AccountReportQuery, now?: number): Promise<PlgState>;
  readonly scope?: 'account' | 'workspace';
}
export function validatePlgState(state: PlgState) {
  if (state.version !== 1 || !Array.isArray(state.contacts) || !Array.isArray(state.deliveries))
    throw new Error('Invalid PLG state');
  // Keep the compatibility budget through the staged normalized-storage release.
  // Raising enrollment or materialization limits needs a separately qualified policy.
  if (Buffer.byteLength(JSON.stringify(state)) > 750_000)
    throw new PlgError(
      409,
      'Pilot storage capacity reached. Archive or migrate before continuing.',
    );
}
const validate = validatePlgState;
export class MemoryPlgStore implements PlgStore {
  private state = initialPlgState();
  private pending = Promise.resolve();
  async read() {
    await this.pending;
    return structuredClone(this.state);
  }
  async transaction<T>(fn: (state: PlgState) => T): Promise<T> {
    const run = this.pending.then(() => {
      const draft = structuredClone(this.state);
      const result = fn(draft);
      validate(draft);
      this.state = draft;
      return structuredClone(result);
    });
    this.pending = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
export class FilePlgStore implements PlgStore {
  private filename: string;
  private pending = Promise.resolve();
  constructor(directory: string) {
    this.filename = path.resolve(directory, 'state.json');
  }
  async read() {
    await this.pending;
    try {
      const state = JSON.parse(await readFile(this.filename, 'utf8')) as PlgState;
      validate(state);
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return initialPlgState();
      throw error;
    }
  }
  async transaction<T>(fn: (state: PlgState) => T): Promise<T> {
    const run = this.pending.then(async () => {
      await mkdir(path.dirname(this.filename), { recursive: true, mode: 0o700 });
      const lock = this.filename + '.lock';
      try {
        await mkdir(lock);
      } catch {
        throw new PlgError(409, 'Another local operation is running. Retry shortly.');
      }
      try {
        let state: PlgState;
        try {
          state = JSON.parse(await readFile(this.filename, 'utf8'));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          state = initialPlgState();
        }
        validate(state);
        const result = fn(state);
        validate(state);
        const temp = this.filename + '.' + randomUUID() + '.tmp';
        try {
          await writeFile(temp, JSON.stringify(state), { mode: 0o600 });
          await rename(temp, this.filename);
        } finally {
          await rm(temp, { force: true });
        }
        return result;
      } finally {
        await rmdir(lock);
      }
    });
    this.pending = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
export class FirestorePlgStore implements PlgStore {
  private database: Promise<import('@google-cloud/firestore').Firestore> | null = null;
  constructor(
    private projectId: string,
    private databaseId = '(default)',
    private injected?: import('@google-cloud/firestore').Firestore,
  ) {}
  private db() {
    if (this.injected) return Promise.resolve(this.injected);
    return (this.database ??= import('@google-cloud/firestore').then(
      ({ Firestore }) => new Firestore({ projectId: this.projectId, databaseId: this.databaseId }),
    ));
  }
  async accountStorage() {
    const db = await this.db(), control = await db.doc(PLG_STORAGE_AUTHORITY).get();
    if (control.get('protocol') !== 2) return null;
    const value = accountAuthority(control);
    return new AccountPlgStore(db, value.generation);
  }
  async read() {
    const db = await this.db(), control = await db.doc(PLG_STORAGE_AUTHORITY).get();
    if (control.get('protocol') === 2 && control.get('mode') === 'staging_accounts') {
      const authority = accountAuthority(control);
      return new PlgFirestoreStorage(db, validate).readFrozen(authority.sourceAuthority, authority.sourceHash);
    }
    const accounts = await this.accountStorage();
    if (accounts) return accounts.read();
    return new PlgFirestoreStorage(await this.db(), validate).read();
  }
  async transaction<T>(fn: (state: PlgState) => T): Promise<T> {
    const accounts = await this.accountStorage();
    if (accounts) return accounts.transaction(fn);
    return new PlgFirestoreStorage(await this.db(), validate).transaction(fn);
  }
  async readWorkspace(query: AccountReportQuery = {}, now = Date.now()) {
    const db = await this.db(), control = await db.doc(PLG_STORAGE_AUTHORITY).get();
    if (control.get('protocol') === 2 && control.get('mode') === 'accounts')
      return new AccountPlgStore(db, accountAuthority(control).generation).readWorkspace(query, now);
    if (Object.keys(query).length) throw new PlgError(409, 'Campaign paging requires active account storage; refresh the workspace.');
    return this.read();
  }
}
