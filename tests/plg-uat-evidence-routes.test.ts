import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerUatEvidenceRoute } from '../src/server/plg/uat-evidence-routes';

afterEach(() => vi.unstubAllEnvs());

function appFor(email: string | null, read: (email: string) => Promise<unknown>) {
  const app = express();
  app.use((req, _res, next) => { (req as any).sessionUser = email ? { email } : null; next(); });
  registerUatEvidenceRoute(app, read);
  return app;
}

describe('UAT own activity route', () => {
  it('pins Production own reads to the Production runtime and session, never an account override', async () => {
    vi.stubEnv('PLG_OWNER_EVIDENCE_ENABLED', 'true');
    vi.stubEnv('PLG_UAT_RUNTIME', '');
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'hushh-ai-prod');
    const prod = vi.fn(async (email: string) => ({ environment: 'production', email }));
    const app = express();
    app.use((req, _res, next) => { (req as any).sessionUser = { email: 'tester@hushh.ai' }; next(); });
    registerUatEvidenceRoute(app, vi.fn(), prod);
    expect((await request(app).get('/api/plg/my-activity?accountId=other')).status).toBe(400);
    expect((await request(app).get('/api/plg/my-activity')).status).toBe(200);
    expect(prod).toHaveBeenCalledExactlyOnceWith('tester@hushh.ai');
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'hushh-pda-uat');
    const uat = express(); registerUatEvidenceRoute(uat, vi.fn(), prod);
    expect((await request(uat).get('/api/plg/my-activity')).status).toBe(404);
  });
  it('is absent unless the UAT runtime is explicitly enabled', async () => {
    vi.stubEnv('PLG_UAT_EVIDENCE_ENABLED', 'false');
    vi.stubEnv('PLG_UAT_RUNTIME', 'production');
    const read = vi.fn();
    expect((await request(appFor('tester@hushh.ai', read)).get('/api/plg/uat/my-behaviour')).status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });

  it('uses only the verified session owner and rejects account overrides', async () => {
    vi.stubEnv('PLG_UAT_EVIDENCE_ENABLED', 'true');
    vi.stubEnv('PLG_UAT_RUNTIME', 'uat');
    const read = vi.fn(async () => ({ environment: 'uat', deliveryAuthorized: false }));
    const app = appFor('tester@hushh.ai', read);
    expect((await request(app).get('/api/plg/uat/my-behaviour?accountId=other')).status).toBe(400);
    const response = await request(app).get('/api/plg/uat/my-behaviour');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith('tester@hushh.ai');
    expect((await request(appFor(null, read)).get('/api/plg/uat/my-behaviour')).status).toBe(401);
    expect((await request(appFor('other@example.test', read)).get('/api/plg/uat/my-behaviour')).status).toBe(403);
  });
});
