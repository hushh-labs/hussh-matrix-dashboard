import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';
const scope = new AsyncLocalStorage<AbortSignal>();
/** Internal bounded platform operation; never persists a caller signal. */
export const withPlatformCaptureSignal = <T>(signal: AbortSignal, load: () => Promise<T>) => scope.run(signal, load);
export const platformCaptureAborted = () => scope.getStore()?.aborted === true;
/** Install before work and catch a disconnect that occurred before installation. */
export function watchDailyRequest(req: IncomingMessage, res: ServerResponse, controller: AbortController) {
 const cancel = () => controller.abort();
 req.once('aborted', cancel); res.once('close', cancel);
 if (req.aborted || res.destroyed || res.writableEnded) cancel();
 return () => { req.off('aborted', cancel); res.off('close', cancel); };
}
