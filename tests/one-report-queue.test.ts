import { describe, expect, it, vi } from 'vitest';
import { prepareOperatorPlatform } from '../src/server/one-report-queue';
import { readPlatformCapture } from '../src/server/one-platform-capture';

describe('deadline-bound operator platform capture', () => {
  it('finishes capture before starting general fanout', async () => {
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const capture = vi.fn(async () => { await barrier; return { error: null, rows: ['captured'] }; });
    const fanout = vi.fn();
    const report = (async () => { const result = await prepareOperatorPlatform(true, capture); fanout(); return result; })();
    expect(capture).toHaveBeenCalledOnce(); expect(fanout).not.toHaveBeenCalled();
    release(); await expect(report).resolves.toEqual({ error: null, rows: ['captured'] }); expect(fanout).toHaveBeenCalledOnce();
  });
  it('does not start the capture early for ordinary reads', async () => {
    const capture = vi.fn(async () => ({ error: null, rows: ['captured'] }));
    await expect(prepareOperatorPlatform(false, capture)).resolves.toBeNull();
    expect(capture).not.toHaveBeenCalled();
  });
  it('does not launch the remaining fanout when the capture fails', async () => {
    const fanout = vi.fn();
    const report = (async () => { await prepareOperatorPlatform(true, async () => ({ error: 'unavailable', rows: [] })); fanout(); })();
    await expect(report).rejects.toThrow('The One platform capture is unavailable.');
    expect(fanout).not.toHaveBeenCalled();
  });
  it('stops at the existing deadline if the platform query stalls', async () => {
    vi.useFakeTimers();
    try {
      const reader = { createQueryJob: vi.fn(), query: vi.fn(() => new Promise(() => {})) };
      const fanout = vi.fn(), abort = vi.fn();
      const report = (async () => {
        await prepareOperatorPlatform(true, () => readPlatformCapture(reader, { baseline: 'SELECT 1', combined: null }, { guardedDeadlineMs: 90_000, onAbort: abort }));
        fanout();
      })();
      const rejected = expect(report).rejects.toThrow('The One platform capture is unavailable.');
      await vi.advanceTimersByTimeAsync(90_001); await rejected;
      expect(abort).toHaveBeenCalled(); expect(fanout).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
