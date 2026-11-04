import { describe, expect, it, vi } from 'vitest';
import { attemptMailJobAuthority, verifyAttemptMailJobIdentity, runAttemptMailJob } from '../src/server/plg/attempt-mail-job';

const config = (lane = 'dev'): NodeJS.ProcessEnv => ({
  PLG_ATTEMPT_MAIL_JOB_ENABLED: 'true', PLG_ATTEMPT_ENVIRONMENT: lane,
  GOOGLE_CLOUD_PROJECT: 'hushh-ai-prod', CLOUD_RUN_JOB: `one-plg-attempt-mail-${lane}`,
  CLOUD_RUN_TASK_COUNT: '1', CLOUD_RUN_TASK_INDEX: '0', CLOUD_RUN_TASK_ATTEMPT: '0',
  PLG_ATTEMPT_SOURCE_SECRET: 'test-source-key-000000000000000000000000',
  PLG_ATTEMPT_GOOGLE_CLIENT_ID: '123-test.apps.googleusercontent.com',
  PLG_ATTEMPT_GOOGLE_CLIENT_SECRET: 'test-oauth-secret',
});

describe('private attempt mail job', () => {
  it.each(['dev', 'uat'])('pins %s to its own source and the shared mailbox identity', async lane => {
    const authority = attemptMailJobAuthority(config(lane));
    expect(authority).toMatchObject({ lane, project: 'hushh-ai-prod', database: 'one-plg-production',
      principal: `one-plg-attempt-mail-${lane}@hushh-ai-prod.iam.gserviceaccount.com` });
    const transport = vi.fn(async (url: string, init: RequestInit) => {
      expect(init.headers).toEqual({ 'Metadata-Flavor': 'Google' });
      expect(init.redirect).toBe('error');
      return new Response(url.endsWith('project-id') ? authority.project : authority.principal,
        { headers: { 'Metadata-Flavor': 'Google' } });
    });
    await verifyAttemptMailJobIdentity(authority, transport as typeof fetch);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('rejects public services, nonproduction credentials, retries and authority overrides', () => {
    for (const override of [
      { PLG_ATTEMPT_MAIL_JOB_ENABLED: 'false' }, { PLG_ATTEMPT_ENVIRONMENT: 'production' },
      { GOOGLE_CLOUD_PROJECT: 'hushh-pda-dev' }, { CLOUD_RUN_JOB: 'one-plg-attempt-mail-uat' },
      { CLOUD_RUN_TASK_COUNT: '2' }, { CLOUD_RUN_TASK_INDEX: '1' }, { CLOUD_RUN_TASK_ATTEMPT: '1' },
      { K_SERVICE: 'hushh-matrix-dashboard' }, { GOOGLE_APPLICATION_CREDENTIALS: '/tmp/key.json' },
      { FIRESTORE_EMULATOR_HOST: 'localhost:8189' }, { PLG_ENABLED: 'true' },
      { PLG_DELIVERY_ENABLED: 'true' }, { PLG_GOOGLE_MAIL_ENABLED: 'true' },
      { PLG_ATTEMPT_EMAIL_ENABLED: 'true' }, { PLG_DEV_RUNTIME: 'dev' }, { PLG_UAT_RUNTIME: 'uat' },
      { PLG_ATTEMPT_MAIL_PROJECT: 'other' }, { PLG_ATTEMPT_MAIL_DATABASE: 'other' },
      { PLG_ATTEMPT_MAIL_CREDENTIAL_SECRET: 'other' }, { PLG_ATTEMPT_SOURCE_SECRET: 'short' },
      { PLG_ATTEMPT_GOOGLE_CLIENT_ID: 'invalid' }, { PLG_ATTEMPT_GOOGLE_CLIENT_SECRET: '' },
      { PLG_ATTEMPT_GOOGLE_CLIENT_SECRET: config().PLG_ATTEMPT_SOURCE_SECRET },
    ]) expect(() => attemptMailJobAuthority({ ...config(), ...override })).toThrow('authority');
  });

  it('requires both the native project and exact job principal', async () => {
    const authority = attemptMailJobAuthority(config());
    for (const [project, principal, flavor] of [
      ['hushh-pda-dev', authority.principal, 'Google'],
      [authority.project, 'matrix-runtime@hushh-pda-dev.iam.gserviceaccount.com', 'Google'],
      [authority.project, 'one-plg-attempt-mail-uat@hushh-ai-prod.iam.gserviceaccount.com', 'Google'],
      [authority.project, authority.principal, ''],
    ]) {
      const transport = vi.fn(async (url: string) => new Response(url.endsWith('project-id') ? project : principal,
        { headers: { 'Metadata-Flavor': flavor } }));
      await expect(verifyAttemptMailJobIdentity(authority, transport as typeof fetch)).rejects.toThrow('authority');
    }
  });

  it('stops before source, credential or provider access when native identity fails', async () => {
    const transport = vi.fn(async (_url: string, _init?: RequestInit) => new Response('unauthorized', { status: 403 }));
    vi.stubGlobal('fetch', transport);
    try {
      await expect(runAttemptMailJob(config())).rejects.toThrow('authority');
      expect(transport).toHaveBeenCalledTimes(1);
      expect(String(transport.mock.calls[0][0])).toContain('metadata.google.internal/computeMetadata/v1/project/project-id');
    } finally { vi.unstubAllGlobals(); }
  });
});
