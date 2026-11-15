type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem'>;
type Recovery = { origin: string; entry: string | null; storage: RecoveryStorage; reload: () => void };
const key = 'metrics.stale-chunk-reload';

/** Reload at most once per entry asset, and only for a same-origin hashed JS import. */
export function recoverStaleChunk(error: unknown, context: Recovery): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!/failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module/i.test(message)) return false;
  const match = message.match(/https?:\/\/[^\s"'<>]+/i); if (!match || !context.entry) return false;
  try {
    const asset = new URL(match[0].replace(/[),.;]+$/, '')), entry = new URL(context.entry, context.origin);
    const hashed = /^\/assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.js$/;
    if (asset.origin !== context.origin || entry.origin !== context.origin || !hashed.test(asset.pathname) || !hashed.test(entry.pathname)
      || asset.search || asset.hash || entry.search || entry.hash) return false;
    const marker = key + ':' + entry.pathname;
    if (context.storage.getItem(marker)) return false;
    context.storage.setItem(marker, '1'); context.reload(); return true;
  } catch { return false; }
}

export function recoverCurrentStaleChunk(error: unknown): boolean {
  try {
    const entry = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src ?? null;
    return recoverStaleChunk(error, { origin: window.location.origin, entry, storage: window.sessionStorage, reload: () => window.location.reload() });
  } catch { return false; }
}
