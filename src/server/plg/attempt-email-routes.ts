import type express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { OneAttemptEmails } from './attempt-email-source';
import { AttemptMailControl } from './attempt-email-control';
import { FirestoreMailControl, SecretManagerMailCredentials } from './google-mail-store';
import { GoogleMail, GoogleMailOAuth } from './google-mail';
import { runAttemptEmailCycle } from './attempt-email-worker';
import { PlgError } from './engine';

/** No defaults, borrowed read key, account override or activation through browsing. */
export function attemptRuntime(env = process.env) {
  if (env.PLG_ATTEMPT_EMAIL_ENABLED !== 'true') throw new PlgError(404, 'Attempt emails are not enabled.');
  const lane = env.PLG_ATTEMPT_ENVIRONMENT;
  const project = lane === 'uat' ? 'hushh-pda-uat' : lane === 'production' ? 'hushh-ai-prod' : null;
  const sourceSecret = env.PLG_ATTEMPT_SOURCE_SECRET ?? '', workerSecret = env.PLG_ATTEMPT_WORKER_SECRET ?? '';
  if (!project || env.GOOGLE_CLOUD_PROJECT !== project || sourceSecret.length < 32 || workerSecret.length < 32 ||
    sourceSecret === workerSecret || [sourceSecret, workerSecret].some(s =>
      [env.PLG_UAT_SOURCE_SECRET, env.PLG_OWNER_SOURCE_SECRET, env.PLG_ONE_SOURCE_SECRET, env.PLG_ONE_SUBSCRIPTION_SECRET,
        env.PLG_ONE_AUDIENCE_SECRET, env.PLG_SYNC_SECRET, env.PLG_CYCLE_SECRET, env.PLG_SIGNING_SECRET].includes(s)) ||
    lane === 'uat' && env.PLG_UAT_RUNTIME !== 'uat' || lane === 'production' && env.PLG_UAT_RUNTIME === 'uat')
    throw new PlgError(503, 'Attempt email authority is not configured.');
  return { lane: lane as 'uat' | 'production', sourceSecret, workerSecret };
}

function configuredCycle() {
  const runtime = attemptRuntime(), env = process.env;
  // The mailbox control is deliberately shared: OAuth disconnect, provider
  // backoff and pacing apply to the mailbox, regardless of the source lane.
  // Only attempt feedback/leases are namespaced; product records remain in One.
  const project = env.PLG_ATTEMPT_MAIL_PROJECT, database = env.PLG_ATTEMPT_MAIL_DATABASE;
  const resource = env.PLG_ATTEMPT_MAIL_CREDENTIAL_SECRET;
  if (!project || !database || resource !== `projects/${project}/secrets/metrics-one-plg-google-mail` ||
    !env.PLG_ATTEMPT_GOOGLE_CLIENT_ID || !env.PLG_ATTEMPT_GOOGLE_CLIENT_SECRET || !env.PLG_ATTEMPT_GOOGLE_REDIRECT_URI)
    throw new PlgError(503, 'Attempt mailbox authority is not configured.');
  const control = new AttemptMailControl(new FirestoreMailControl(project, database), runtime.lane);
  const mail = new GoogleMail(control, new SecretManagerMailCredentials(resource), new GoogleMailOAuth({
    clientId: env.PLG_ATTEMPT_GOOGLE_CLIENT_ID, clientSecret: env.PLG_ATTEMPT_GOOGLE_CLIENT_SECRET,
    redirectUri: env.PLG_ATTEMPT_GOOGLE_REDIRECT_URI,
  }, true));
  return () => runAttemptEmailCycle(new OneAttemptEmails(runtime.lane, runtime.sourceSecret), mail, control);
}

export function registerAttemptEmailRoute(app: express.Express, injected?: () => Promise<unknown>) {
  app.post('/integrations/plg/attempts', async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    try {
      const runtime = attemptRuntime(), timestamp = req.get('X-PLG-Timestamp') ?? '', signature = req.get('X-PLG-Signature') ?? '';
      const raw = (req as any).plgRawBody;
      if (raw !== '{}' || !/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 300_000 || !/^[a-f0-9]{64}$/.test(signature))
        throw new PlgError(401, 'Invalid attempt worker signature.');
      const expected = createHmac('sha256', runtime.workerSecret).update(`attempt-cycle.${runtime.lane}\n${timestamp}\n${raw}`).digest('hex');
      if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex')))
        throw new PlgError(401, 'Invalid attempt worker signature.');
      return res.json(await (injected ?? configuredCycle())());
    } catch (error) {
      return res.status(error instanceof PlgError ? error.status : 503).json({ error: 'Attempt email cycle did not confirm completion.' });
    }
  });
}
