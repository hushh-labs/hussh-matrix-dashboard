import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlgWorkspaceReader, PLG_STATUS_REFRESH_MS, watchPlgWorkspaceStatus } from '../src/lib/plg-workspace-refresh';

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(stop => stop()); vi.useRealTimers(); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function readerHarness(read: (signal: AbortSignal) => Promise<string>) {
  const accept = vi.fn(), reject = vi.fn();
  const reader = createPlgWorkspaceReader({ read, accept, reject });
  reader.activate(); cleanup.push(() => reader.deactivate());
  return { reader, accept, reject };
}
function watcher(refresh: () => Promise<void>, cancel: () => void = vi.fn()) {
  const doc = new EventTarget(), win = new EventTarget();
  let visible = true, idle = true;
  const stop = watchPlgWorkspaceStatus({ refresh, cancel, documentTarget: doc, windowTarget: win,
    visible: () => visible, idle: () => idle });
  cleanup.push(stop);
  return { stop, cancel, focus: () => win.dispatchEvent(new Event('focus')),
    visibility(value: boolean) { visible = value; doc.dispatchEvent(new Event('visibilitychange')); },
    idle(value: boolean) { idle = value; } };
}

describe('PLG workspace read ownership', () => {
  it('coalesces background reads and only accepts the latest foreground response', async () => {
    const old = deferred<string>(), fresh = deferred<string>();
    const read = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const { reader, accept, reject } = readerHarness(read);
    const first = reader.refresh(true);
    await reader.refresh(true);
    expect(read).toHaveBeenCalledTimes(1);
    const second = reader.refresh();
    expect(read.mock.calls[0][0].aborted).toBe(true);
    fresh.resolve('current'); await second;
    old.resolve('stale'); await first;
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept).toHaveBeenCalledWith('current', expect.any(Number));
    expect(reject).not.toHaveBeenCalled();
  });

  it('fences an old read before a mutation even if its transport ignores abort', async () => {
    const old = deferred<string>();
    const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce('saved setting');
    const { reader, accept, reject } = readerHarness(read);
    const pending = reader.refresh(); reader.cancel();
    await reader.refresh();
    old.reject(new Error('late failure')); await pending;
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept.mock.calls[0][0]).toBe('saved setting');
    expect(reject).not.toHaveBeenCalled();
  });

  it('aborts unmounted work and permits React effect reactivation without reviving it', async () => {
    const old = deferred<string>();
    const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce('remounted');
    const { reader, accept } = readerHarness(read);
    const pending = reader.refresh(); reader.deactivate();
    await reader.refresh(); expect(read).toHaveBeenCalledTimes(1);
    reader.activate(); await reader.refresh();
    old.resolve('unmounted'); await pending;
    expect(read.mock.calls[0][0].aborted).toBe(true);
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept.mock.calls[0][0]).toBe('remounted');
  });

  it('does not report a failed read as a fresh successful snapshot', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-27T11:00:00Z'));
    const failure = new Error('workspace access denied');
    const { reader, accept, reject } = readerHarness(vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce('verified'));
    await reader.refresh();
    expect(accept).not.toHaveBeenCalled(); expect(reject).toHaveBeenCalledWith(failure);
    await reader.refresh();
    expect(accept).toHaveBeenCalledWith('verified', Date.now());
  });
});

describe('visible PLG status scheduling', () => {
  it('refreshes on entry, periodically and on focus, with no overlapping requests', async () => {
    vi.useFakeTimers();
    const pending = deferred<void>();
    const refresh = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    const watched = watcher(refresh);
    watched.focus(); await vi.advanceTimersByTimeAsync(3 * PLG_STATUS_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    pending.resolve(); await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(PLG_STATUS_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
    watched.focus(); await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(3);
    watched.stop(); expect(vi.getTimerCount()).toBe(0);
    watched.focus(); await vi.advanceTimersByTimeAsync(PLG_STATUS_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('aborts hidden reads and accepts a fresh visible read before a stale completion', async () => {
    vi.useFakeTimers();
    const old = deferred<string>(), fresh = deferred<string>();
    const read = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const { reader, accept } = readerHarness(read);
    const watched = watcher(() => reader.refresh(true), () => reader.cancelBackground());
    watched.visibility(false);
    expect(read.mock.calls[0][0].aborted).toBe(true);
    watched.focus(); await vi.advanceTimersByTimeAsync(3 * PLG_STATUS_REFRESH_MS);
    expect(read).toHaveBeenCalledTimes(1);
    watched.visibility(true); expect(read).toHaveBeenCalledTimes(2);
    fresh.resolve('visible current'); await vi.advanceTimersByTimeAsync(0);
    old.resolve('hidden old'); await vi.advanceTimersByTimeAsync(0);
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept.mock.calls[0][0]).toBe('visible current');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('skips reads while mutations are busy and cancels polling on view cleanup', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const watched = watcher(refresh);
    await vi.advanceTimersByTimeAsync(0);
    watched.idle(false);
    watched.focus(); await vi.advanceTimersByTimeAsync(2 * PLG_STATUS_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    watched.idle(true); watched.focus(); await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
    watched.stop(); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2 * PLG_STATUS_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not reschedule when an in-flight read settles after view cleanup', async () => {
    vi.useFakeTimers();
    const pending = deferred<void>();
    const refresh = vi.fn(() => pending.promise);
    const watched = watcher(refresh); watched.stop(); watched.stop();
    pending.resolve(); await vi.advanceTimersByTimeAsync(2 * PLG_STATUS_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(watched.cancel).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
});
