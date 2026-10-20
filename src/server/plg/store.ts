import { mkdir, readFile, rename, writeFile, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PlgState } from '../../lib/plg';
import { initialPlgState, PlgError } from './engine';

export interface PlgStore {
  read(): Promise<PlgState>;
  transaction<T>(fn: (state: PlgState) => T): Promise<T>;
}
function validate(state: PlgState) {
  if (state.version !== 1 || !Array.isArray(state.contacts) || !Array.isArray(state.deliveries))
    throw new Error('Invalid PLG state');
  // This intentionally bounded pilot uses a single transactional document.
  // Refuse writes before Firestore's 1 MiB limit rather than silently trim history.
  if (Buffer.byteLength(JSON.stringify(state)) > 750_000)
    throw new PlgError(
      409,
      'Pilot storage capacity reached. Archive or migrate before continuing.',
    );
}
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
  ) {}
  private db() {
    return (this.database ??= import('@google-cloud/firestore').then(
      ({ Firestore }) => new Firestore({ projectId: this.projectId, databaseId: this.databaseId }),
    ));
  }
  async read() {
    const db = await this.db();
    const doc = await db.doc('one_plg_pilot/state').get();
    if (!doc.exists) return initialPlgState();
    const state = JSON.parse(doc.get('payload')) as PlgState;
    validate(state);
    return state;
  }
  async transaction<T>(fn: (state: PlgState) => T): Promise<T> {
    const db = await this.db();
    const ref = db.doc('one_plg_pilot/state');
    return db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const state = doc.exists ? (JSON.parse(doc.get('payload')) as PlgState) : initialPlgState();
      validate(state);
      const result = fn(state);
      validate(state);
      tx.set(ref, { payload: JSON.stringify(state), updatedAt: new Date().toISOString() });
      return result;
    });
  }
}
