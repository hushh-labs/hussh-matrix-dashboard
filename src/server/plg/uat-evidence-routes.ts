import type express from 'express';
import { readUatSessionEvidence } from './uat-own-evidence';

/** Registered only by an explicitly configured UAT runtime. */
export function registerUatEvidenceRoute(
  app: express.Express,
  read: (email: string) => Promise<unknown> = readUatSessionEvidence,
) {
  if (process.env.PLG_UAT_EVIDENCE_ENABLED !== 'true' || process.env.PLG_UAT_RUNTIME !== 'uat') return;
  app.get('/api/plg/uat/my-behaviour', (req, res) => {
    res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff' });
    if (Object.keys(req.query).length) return res.status(400).json({ error: 'Account overrides are not accepted.' });
    const email = (req as any).sessionUser?.email;
    if (typeof email !== 'string' || !email) return res.status(401).json({ error: 'Authentication required.' });
    if (!/^[^\s@<>]+@hushh\.ai$/i.test(email)) return res.status(403).json({ error: 'UAT work-account access only.' });
    return Promise.resolve().then(() => read(email)).then(result => res.json(result)).catch(() =>
      res.status(503).json({ error: 'UAT activity evidence is unavailable.' }));
  });
}
