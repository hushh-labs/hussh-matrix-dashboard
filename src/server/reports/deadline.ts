/** Bound infrastructure SDK waits as well as fetch. Native work may still be
 * uncertain after cancellation; callers retain their durable reservation. */
export async function withinDeadline<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort!: () => void;
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason ?? new Error('Deadline exceeded'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try { return await Promise.race([pending, stopped]); }
  finally { signal.removeEventListener('abort', abort); }
}
