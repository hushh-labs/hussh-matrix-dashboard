import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ access: vi.fn(), read: vi.fn(), request: vi.fn(), status: vi.fn() }));
vi.mock('./lib/access', () => ({ currentAccess: mocks.access }));
vi.mock('./lib/runtime', () => ({ reportsRuntime: () => ({ read: mocks.read, request: mocks.request, status: mocks.status }) }));

const access = { subjectHash: 'a'.repeat(64), scopeDigest: 'b'.repeat(64) };
const selection = { reportId: 'one.adoption', startDate: '2026-11-18', endDate: '2026-11-18', timezone: 'UTC' };
const jobId = 'c'.repeat(64);
function privateHeaders(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Vary')).toBe('Cookie, Authorization');
}
beforeEach(() => { mocks.access.mockResolvedValue(access); vi.stubEnv('METRICS_WEB_ORIGIN', 'https://metrics.example'); });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('private generic reporting routes', () => {
  it.each(['report', 'status', 'admission'] as const)('sanitizes and does not cache a %s session failure', async route => {
    mocks.access.mockRejectedValueOnce(new Error('private session diagnostics'));
    let response: Response;
    if (route === 'report') {
      const { GET } = await import('./app/api/reports/[reportId]/route');
      response = await GET(new Request('https://metrics.example/api/reports/one.adoption'), { params: Promise.resolve({ reportId: selection.reportId }) });
    } else if (route === 'status') {
      const { GET } = await import('./app/api/report-jobs/[jobId]/route');
      response = await GET(new Request(`https://metrics.example/api/report-jobs/${jobId}`), { params: Promise.resolve({ jobId }) });
    } else {
      const { POST } = await import('./app/api/report-jobs/route');
      response = await POST(new Request('https://metrics.example/api/report-jobs', { method: 'POST' }));
    }
    expect(response.status).toBe(503); privateHeaders(response);
    expect(await response.text()).not.toContain('private session diagnostics');
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.status).not.toHaveBeenCalled();
  });
  it('protects successful, anonymous and failed report reads', async () => {
    const { GET } = await import('./app/api/reports/[reportId]/route');
    const request = new Request('https://metrics.example/api/reports/one.adoption?startDate=2026-11-18&endDate=2026-11-18&timezone=UTC');
    const context = { params: Promise.resolve({ reportId: selection.reportId }) };
    mocks.read.mockResolvedValue({ state: 'unavailable', report: null });
    const success = await GET(request, context); expect(success.status).toBe(200); privateHeaders(success);
    expect(mocks.read).toHaveBeenCalledWith(selection, access); expect(mocks.request).not.toHaveBeenCalled();
    mocks.access.mockResolvedValueOnce(null); const anonymous = await GET(request, context);
    expect(anonymous.status).toBe(401); privateHeaders(anonymous); expect(mocks.read).toHaveBeenCalledTimes(1);
    mocks.read.mockRejectedValueOnce(new Error('private details')); const failure = await GET(request, context);
    expect(failure.status).toBe(503); privateHeaders(failure); expect(await failure.text()).not.toContain('private details');
  });
  it('protects successful, anonymous and failed job status reads', async () => {
    const { GET } = await import('./app/api/report-jobs/[jobId]/route');
    const request = new Request(`https://metrics.example/api/report-jobs/${jobId}`), context = { params: Promise.resolve({ jobId }) };
    mocks.status.mockResolvedValue({ state: 'running', jobId }); const success = await GET(request, context);
    expect(success.status).toBe(200); privateHeaders(success); expect(mocks.status).toHaveBeenCalledWith(jobId, access);
    mocks.access.mockResolvedValueOnce(null); const anonymous = await GET(request, context);
    expect(anonymous.status).toBe(401); privateHeaders(anonymous); expect(mocks.status).toHaveBeenCalledTimes(1);
    mocks.status.mockRejectedValueOnce(new Error('private details')); const failure = await GET(request, context);
    expect(failure.status).toBe(503); privateHeaders(failure); expect(await failure.text()).not.toContain('private details');
  });
  it('protects admitted, anonymous, cross-origin and failed job requests', async () => {
    const { POST } = await import('./app/api/report-jobs/route');
    const request = (origin = 'https://metrics.example') => new Request('https://metrics.example/api/report-jobs', {
      method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(selection),
    });
    mocks.request.mockResolvedValue({ state: 'accepted', jobId, reportId: null });
    const accepted = await POST(request()); expect(accepted.status).toBe(202); privateHeaders(accepted);
    expect(mocks.request).toHaveBeenCalledWith(selection, access);
    mocks.access.mockResolvedValueOnce(null); const anonymous = await POST(request());
    expect(anonymous.status).toBe(401); privateHeaders(anonymous);
    const crossOrigin = await POST(request('https://other.example')); expect(crossOrigin.status).toBe(403); privateHeaders(crossOrigin);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    mocks.request.mockRejectedValueOnce(new Error('private details')); const failure = await POST(request());
    expect(failure.status).toBe(503); privateHeaders(failure); expect(await failure.text()).not.toContain('private details');
  });
});
