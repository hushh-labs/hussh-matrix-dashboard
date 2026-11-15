import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { watchDailyRequest } from '../src/server/platform-capture-signal';
function connection(alreadyClosed = false) {
 const req = Object.assign(new EventEmitter(), { aborted: false }) as unknown as IncomingMessage;
 const res = Object.assign(new EventEmitter(), { destroyed: alreadyClosed, writableEnded: false }) as unknown as ServerResponse;
 return { req, res };
}
describe('daily request disconnect', () => {
 it('immediately aborts when the response closed before listeners were installed', () => {
  const { req, res } = connection(true), controller = new AbortController();
  const unwatch = watchDailyRequest(req, res, controller); expect(controller.signal.aborted).toBe(true); unwatch();
 });
 it('aborts on a later disconnect and removes listeners after completion', () => {
  const { req, res } = connection(), controller = new AbortController(), unwatch = watchDailyRequest(req, res, controller);
  expect(controller.signal.aborted).toBe(false); res.emit('close'); expect(controller.signal.aborted).toBe(true); unwatch();
  const next = connection(), nextController = new AbortController(), cleanup = watchDailyRequest(next.req, next.res, nextController);
  cleanup(); next.res.emit('close'); expect(nextController.signal.aborted).toBe(false);
 });
 it('does not confuse a completed incoming request with a closed response', () => {
  const { req, res } = connection(); Object.assign(req, { complete: true, destroyed: true });
  const controller = new AbortController(), unwatch = watchDailyRequest(req, res, controller);
  expect(controller.signal.aborted).toBe(false); unwatch();
 });
});
