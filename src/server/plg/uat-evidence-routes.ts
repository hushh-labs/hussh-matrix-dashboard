import type express from 'express';
import { readDevSessionEvidence, readProductionSessionEvidence, readUatSessionEvidence } from './uat-own-evidence';

/** Each own-activity route requires its explicitly configured runtime. */
export function registerUatEvidenceRoute(
  app: express.Express,
  read: (email: string) => Promise<unknown> = readUatSessionEvidence,
  readProduction: (email: string) => Promise<unknown> = readProductionSessionEvidence,
  readDev: (email: string) => Promise<unknown> = readDevSessionEvidence,
) {
  if (process.env.PLG_DEV_EVIDENCE_ENABLED === 'true' && process.env.PLG_DEV_RUNTIME === 'dev' &&
    process.env.GOOGLE_CLOUD_PROJECT === 'hushh-pda-dev' && process.env.PLG_UAT_RUNTIME !== 'uat')
    registerOwnRoute(app, '/api/plg/dev/my-behaviour', readDev);
  if (process.env.PLG_UAT_EVIDENCE_ENABLED === 'true' && process.env.PLG_UAT_RUNTIME === 'uat')
    registerOwnRoute(app, '/api/plg/uat/my-behaviour', read);
  if (process.env.PLG_OWNER_EVIDENCE_ENABLED === 'true' && process.env.PLG_UAT_RUNTIME !== 'uat' &&
    process.env.GOOGLE_CLOUD_PROJECT === 'hushh-ai-prod')
    registerOwnRoute(app, '/api/plg/my-activity', readProduction);
}

function registerOwnRoute(app: express.Express, path: string, read: (email: string) => Promise<unknown>) {
  app.get(path, (req, res) => {
    res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff' });
    if (Object.keys(req.query).length) return res.status(400).json({ error: 'Account overrides are not accepted.' });
    const email = (req as any).sessionUser?.email;
    if (typeof email !== 'string' || !email) return res.status(401).json({ error: 'Authentication required.' });
    if (!/^[^\s@<>]+@hushh\.ai$/i.test(email)) return res.status(403).json({ error: 'Work-account access only.' });
    return Promise.resolve().then(() => read(email)).then(result => res.json(result)).catch(() =>
      res.status(503).json({ error: 'Own activity evidence is unavailable.' }));
  });
}
