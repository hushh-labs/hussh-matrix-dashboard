import { describe, expect, it, vi } from 'vitest';
import { recoverStaleChunk } from '../src/lib/stale-chunk-recovery';
function fixture() {
 const data = new Map<string,string>(), reload = vi.fn();
 const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key,value); } };
 return { origin: 'https://metrics.hussh.ai', entry: 'https://metrics.hussh.ai/assets/index-AbCd1234.js', storage, reload };
}
const failure = (url = 'https://metrics.hussh.ai/assets/OneAppPanel-Zz123456.js') => new TypeError(`Failed to fetch dynamically imported module: ${url}`);
describe('stale chunk recovery', () => {
 it('reloads once per entry asset and permits one recovery for a later revision', () => {
  const c = fixture(); expect(recoverStaleChunk(failure(),c)).toBe(true); expect(recoverStaleChunk(failure(),c)).toBe(false); expect(c.reload).toHaveBeenCalledTimes(1);
  c.entry = 'https://metrics.hussh.ai/assets/index-New12345.js'; expect(recoverStaleChunk(failure(),c)).toBe(true); expect(recoverStaleChunk(failure(),c)).toBe(false);
  c.entry = 'https://metrics.hussh.ai/assets/index-AbCd1234.js'; expect(recoverStaleChunk(failure(),c)).toBe(false); expect(c.reload).toHaveBeenCalledTimes(2);
 });
 it('does not reload for external, unversioned, unrelated, malformed or untrusted errors', () => {
  const c = fixture(); for (const error of [failure('https://elsewhere.invalid/assets/OneAppPanel-Zz123456.js'), failure('https://metrics.hussh.ai/assets/plain.js'), failure('https://metrics.hussh.ai/assets/OneAppPanel-Zz123456.js?x=1'), new Error('Application state is invalid'), new Error('Failed to fetch dynamically imported module')]) expect(recoverStaleChunk(error,c)).toBe(false);
  expect(c.reload).not.toHaveBeenCalled();
 });
 it('fails closed if session storage is unavailable', () => {
  const c = fixture(); c.storage.getItem = () => { throw new Error('storage disabled'); }; expect(recoverStaleChunk(failure(),c)).toBe(false); expect(c.reload).not.toHaveBeenCalled();
 });
});
