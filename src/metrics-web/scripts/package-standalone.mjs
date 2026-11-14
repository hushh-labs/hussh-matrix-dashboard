import { cp } from 'node:fs/promises';

// Next standalone output does not copy browser assets automatically.
await cp(new URL('../.next/static/', import.meta.url),
  new URL('../.next/standalone/src/metrics-web/.next/static/', import.meta.url), { recursive: true });
