import { AsyncLocalStorage } from 'node:async_hooks';
const scope = new AsyncLocalStorage<AbortSignal>();
/** Internal bounded platform operation; never persists a caller signal. */
export const withPlatformCaptureSignal = <T>(signal: AbortSignal, load: () => Promise<T>) => scope.run(signal, load);
export const platformCaptureAborted = () => scope.getStore()?.aborted === true;
