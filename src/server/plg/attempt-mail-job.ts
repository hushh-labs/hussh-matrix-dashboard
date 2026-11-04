import { GoogleMail, GoogleMailOAuth } from './google-mail';
import { FirestoreMailControl, SecretManagerMailCredentials } from './google-mail-store';
import { AttemptMailControl } from './attempt-email-control';
import { OneAttemptEmails } from './attempt-email-source';
import { runAttemptEmailCycle } from './attempt-email-worker';

const project = 'hushh-ai-prod';
const database = 'one-plg-production';
const refused = () => new Error('Private attempt mail job authority was not confirmed.');

/** No HTTP listener or caller-supplied recipient, message, source or store. */
export function attemptMailJobAuthority(env: NodeJS.ProcessEnv = process.env) {
  const lane = env.PLG_ATTEMPT_ENVIRONMENT;
  if (env.PLG_ATTEMPT_MAIL_JOB_ENABLED !== 'true' || !['dev', 'uat'].includes(lane ?? '') ||
    env.GOOGLE_CLOUD_PROJECT !== project || env.CLOUD_RUN_JOB !== `one-plg-attempt-mail-${lane}` ||
    env.CLOUD_RUN_TASK_COUNT !== '1' || env.CLOUD_RUN_TASK_INDEX !== '0' || env.CLOUD_RUN_TASK_ATTEMPT !== '0' ||
    env.K_SERVICE || env.FIRESTORE_EMULATOR_HOST || env.GOOGLE_APPLICATION_CREDENTIALS ||
    env.PLG_ENABLED === 'true' || env.PLG_DELIVERY_ENABLED === 'true' || env.PLG_GOOGLE_MAIL_ENABLED === 'true' ||
    env.PLG_ATTEMPT_EMAIL_ENABLED === 'true' || env.PLG_DEV_RUNTIME || env.PLG_UAT_RUNTIME ||
    env.PLG_ATTEMPT_MAIL_PROJECT || env.PLG_ATTEMPT_MAIL_DATABASE || env.PLG_ATTEMPT_MAIL_CREDENTIAL_SECRET ||
    !/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(env.PLG_ATTEMPT_GOOGLE_CLIENT_ID ?? '') ||
    !env.PLG_ATTEMPT_GOOGLE_CLIENT_SECRET || (env.PLG_ATTEMPT_SOURCE_SECRET?.length ?? 0) < 32 ||
    env.PLG_ATTEMPT_SOURCE_SECRET === env.PLG_ATTEMPT_GOOGLE_CLIENT_SECRET)
    throw refused();
  return { lane: lane as 'dev' | 'uat', project, database,
    principal: `one-plg-attempt-mail-${lane}@${project}.iam.gserviceaccount.com`,
    sourceSecret: env.PLG_ATTEMPT_SOURCE_SECRET!, clientId: env.PLG_ATTEMPT_GOOGLE_CLIENT_ID!,
    clientSecret: env.PLG_ATTEMPT_GOOGLE_CLIENT_SECRET! };
}

/** Verify native job identity before constructing clients or touching the mailbox. */
export async function verifyAttemptMailJobIdentity(authority: ReturnType<typeof attemptMailJobAuthority>,
  transport: typeof fetch = fetch) {
  for (const [path, expected] of [
    ['project/project-id', authority.project],
    ['instance/service-accounts/default/email', authority.principal],
  ]) {
    const response = await transport(`http://metadata.google.internal/computeMetadata/v1/${path}`, {
      headers: { 'Metadata-Flavor': 'Google' }, redirect: 'error', signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok || response.headers.get('Metadata-Flavor') !== 'Google' ||
      (await response.text()).trim() !== expected) throw refused();
  }
}

export async function runAttemptMailJob(env: NodeJS.ProcessEnv = process.env) {
  const authority = attemptMailJobAuthority(env);
  await verifyAttemptMailJobIdentity(authority);
  const control = new AttemptMailControl(new FirestoreMailControl(project, database), authority.lane);
  const mail = new GoogleMail(control,
    new SecretManagerMailCredentials(`projects/${project}/secrets/metrics-one-plg-google-mail`),
    new GoogleMailOAuth({ clientId: authority.clientId, clientSecret: authority.clientSecret,
      redirectUri: 'https://metrics.hussh.ai/auth/callback' }, true));
  return runAttemptEmailCycle(new OneAttemptEmails(authority.lane, authority.sourceSecret), mail, control);
}
