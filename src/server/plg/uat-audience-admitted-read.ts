import { createHmac, randomBytes } from 'node:crypto';
import type { ReportStore } from '../reports/store';
import { admitUatAudiencePage, finishUatAudiencePage } from './uat-audience-admission';

/** Unwired integration seam: callers must provide UAT-specific authority that
 * checks the current viewer before and after every page. No response is cached.
 * The provider call must fully consume and validate a bounded terminal response;
 * it must throw on uncertain delivery/abort; those claims remain
 * charged and open for external reconciliation, rather than being retried. */
export async function readAdmittedUatPage<T>({ store, viewer, key, authority, read, now = Date.now,
  operation = () => randomBytes(32).toString('hex'), signal }: {
  store: ReportStore; viewer: string; key: string; authority: () => Promise<boolean>;
  read: (signal: AbortSignal) => Promise<{ terminal: true; value: T }>; now?: () => number; operation?: () => string; signal: AbortSignal;
}): Promise<T> {
  if (typeof viewer !== 'string' || !viewer || viewer.length > 254 || typeof key !== 'string' || key.length < 32) throw new Error('UAT audience unavailable');
  signal.throwIfAborted();
  if (!await authority()) throw new Error('UAT audience unavailable');
  signal.throwIfAborted();
  const digest = createHmac('sha256', key).update(`uat-audience-viewer\n${viewer.trim().toLowerCase()}`).digest('hex');
  const id = operation();
  await admitUatAudiencePage(store, digest, id, now());
  // An abort or authority loss after reservation remains charged/open; no I/O.
  signal.throwIfAborted();
  if (!await authority()) throw new Error('UAT audience unavailable');
  signal.throwIfAborted();
  const result = await read(signal);
  if (!result || result.terminal !== true || !Object.hasOwn(result, 'value')) throw new Error('UAT audience unavailable');
  // A complete response can release concurrency, but its day charge is retained.
  await finishUatAudiencePage(store, digest, id);
  signal.throwIfAborted();
  if (!await authority()) throw new Error('UAT audience unavailable');
  signal.throwIfAborted();
  return result.value;
}
