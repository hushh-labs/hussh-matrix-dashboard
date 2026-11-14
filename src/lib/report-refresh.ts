import type { ReportRequest } from '../server/reports/contracts';

export type RefreshOutcome = 'completed' | 'pending' | 'attention' | 'unavailable' | 'unauthorized';
type RefreshDependencies = { fetcher?: typeof fetch; pause?: (ms: number, signal: AbortSignal) => Promise<void>; now?: () => number };

async function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort!: () => void;
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason ?? new Error('Refresh stopped'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try { return await Promise.race([pending, stopped]); }
  finally { signal.removeEventListener('abort', abort); }
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const aborted = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, ms);
    signal.addEventListener('abort', aborted, { once: true });
  });
}

async function responseBody(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Unavailable');
  let bytes = 0, text = ''; const decoder = new TextDecoder();
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await abortable(reader.read(), signal); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 8192) throw new Error('Unavailable');
      text += decoder.decode(chunk.value, { stream: true });
    }
    const value = JSON.parse(text + decoder.decode());
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unavailable');
    return value;
  } finally { void reader.cancel().catch(() => {}); }
}

/** Explicit user action only. Admission itself checks the existing publication
 * and shared job before source work. No background refresh, storage or retries. */
export async function refreshReport(request: ReportRequest, signal: AbortSignal,
  dependencies: RefreshDependencies = {}): Promise<RefreshOutcome> {
  const fetcher = dependencies.fetcher ?? fetch, wait = dependencies.pause ?? pause;
  const now = dependencies.now ?? (() => performance.now()), until = now() + 120_000;
  const rpc = async (url: string, init: RequestInit) => {
    signal.throwIfAborted();
    const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), Math.max(1, Math.min(10_000, until - now())));
    const combined = AbortSignal.any([signal, timeout.signal]);
    try {
      const response = await abortable(fetcher(url, { ...init, signal: combined, cache: 'no-store', credentials: 'same-origin' }), combined);
      if (response.status === 401 || response.status === 403) return { state: 'unauthorized' };
      if (!response.ok) return { state: 'unavailable' };
      return await responseBody(response, combined);
    } finally { clearTimeout(timer); }
  };
  try {
    let value = await rpc('/api/report-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    if (value.state === 'completed') return 'completed';
    if (value.state === 'unauthorized' || value.state === 'unavailable') return value.state;
    const id = value.jobId;
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) return 'unavailable';
    for (let attempt = 0; attempt < 20; attempt++) {
      signal.throwIfAborted();
      if (value.needsAttention === true || value.state === 'failed' || value.state === 'invalidated') return 'attention';
      if (!['accepted', 'running', 'delayed'].includes(String(value.state))) return 'unavailable';
      const remaining = until - now(); if (remaining <= 0) return 'pending';
      const delay = typeof value.retryAfterMs === 'number' && Number.isFinite(value.retryAfterMs) ? value.retryAfterMs : 1000;
      await wait(Math.min(remaining, Math.max(1000, Math.min(delay, 30_000))), signal);
      signal.throwIfAborted(); if (now() >= until) return 'pending';
      value = await rpc(`/api/report-jobs/${id}`, { method: 'GET' });
      if (value.state === 'unauthorized' || value.state === 'unavailable') return value.state;
      if (value.jobId !== id) return 'unavailable';
      if (value.state === 'completed') return 'completed';
    }
    return value.needsAttention === true || value.state === 'failed' || value.state === 'invalidated' ? 'attention' : 'pending';
  } catch (error) {
    if (signal.aborted) throw error;
    return 'unavailable';
  }
}
