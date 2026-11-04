import { describe, expect, it } from 'vitest';
import { assertEnvironmentRevision, assertSourceCi, devRuntimeImage, environmentSecretVersions, environmentService, environmentTarget } from '../scripts/plg-environment-release.mjs';
import { attemptRuntime } from '../src/server/plg/attempt-email-routes';

const source = 'a'.repeat(40);
const image = `us-central1-docker.pkg.dev/hushh-pda-dev/matrix-images/hushh-matrix-dashboard@sha256:${'b'.repeat(64)}`;
const versions = Object.fromEntries(['metrics-dashboard-google-client-secret', 'metrics-dashboard-session-secret',
  'metrics-dashboard-allowed-emails', 'metrics-one-plg-owner-source-secret', 'metrics-one-plg-owner-email-hashes'].map(n => [n, '2']));
const input = (environment = 'dev') => ({ environment, source, image,
  clientId: '123-fixture.apps.googleusercontent.com', versions });

describe('canonical Matrix nonproduction release', () => {
  it.each(['dev', 'uat'])('wires an explicit %s attempt worker without borrowing read authority or copying the mailbox grant', environment => {
    const config = { ...input(environment), readEnabled: true,
      versions: { ...versions, 'metrics-one-plg-attempt-source-secret': '3', 'metrics-one-plg-attempt-worker-secret': '4' },
      attemptEmail: { clientId: '456-mailbox.apps.googleusercontent.com', clientSecretVersion: '7' } };
    const document = environmentService(config);
    const entries = document.spec.template.spec.containers[0].env;
    const env = Object.fromEntries(entries.map(e => [e.name, e]));
    expect(env.PLG_ATTEMPT_EMAIL_ENABLED.value).toBe('true');
    expect(env.PLG_ATTEMPT_ENVIRONMENT.value).toBe(environment);
    expect(env.PLG_ATTEMPT_SOURCE_SECRET.valueFrom.secretKeyRef).toEqual({ name: 'metrics-one-plg-attempt-source-secret', key: '3' });
    expect(env.PLG_ATTEMPT_WORKER_SECRET.valueFrom.secretKeyRef).toEqual({ name: 'metrics-one-plg-attempt-worker-secret', key: '4' });
    expect(env.PLG_ATTEMPT_GOOGLE_CLIENT_SECRET.valueFrom.secretKeyRef).toEqual({ name: 'attempt-mail-oauth', key: '7' });
    expect(env.PLG_ATTEMPT_MAIL_CREDENTIAL_SECRET.value).toBe('projects/hushh-ai-prod/secrets/metrics-one-plg-google-mail');
    expect(env.PLG_GOOGLE_MAIL_ENABLED.value).toBe('false');
    expect(env.PLG_DELIVERY_ENABLED.value).toBe('false');
    expect(environmentSecretVersions(config)).toContainEqual({ project: 'hushh-ai-prod', secret: 'metrics-dashboard-google-client-secret', version: '7' });
    const resolved = Object.fromEntries(entries.map(e => [e.name, e.value ?? e.valueFrom.secretKeyRef.name.repeat(2)]));
    expect(attemptRuntime(resolved).lane).toBe(environment);
    const revision = { metadata: structuredClone(document.spec.template.metadata),
      spec: structuredClone(document.spec.template.spec), status: { conditions: [{ type: 'Ready', status: 'True' }] } };
    expect(() => assertEnvironmentRevision(revision, document)).not.toThrow();
    revision.metadata.annotations['run.googleapis.com/secrets'] = 'attempt-mail-oauth:projects/unrelated/secrets/key';
    expect(() => assertEnvironmentRevision(revision, document)).toThrow('Mailbox secret reference mismatch');
    for (const patch of [{ readEnabled: false }, { versions },
      { attemptEmail: { ...config.attemptEmail, clientSecretVersion: 'latest' } },
      { attemptEmail: { ...config.attemptEmail, project: 'unrelated' } }])
      expect(() => environmentService({ ...config, ...patch })).toThrow();
  });

  it.each(['dev', 'uat'])('pins %s identity, source and credentials without campaign or send authority', environment => {
    const document = environmentService(input(environment));
    const config = document.spec.template.spec;
    expect(config.serviceAccountName).toBe(`matrix-runtime@hushh-pda-${environment}.iam.gserviceaccount.com`);
    const env = Object.fromEntries(config.containers[0].env.map(e => [e.name, e]));
    expect(env.GOOGLE_REDIRECT_URI.value).toBe(`${environmentTarget(environment).origin}/auth/callback`);
    expect(env.PLG_ATTEMPT_EMAIL_ENABLED.value).toBe('false');
    expect(env[`PLG_${environment.toUpperCase()}_EVIDENCE_ENABLED`].value).toBe('false');
    expect(env.SESSION_SECRET.valueFrom.secretKeyRef).toEqual({ name: 'metrics-dashboard-session-secret', key: '2' });
    for (const forbidden of ['PLG_ONE_SOURCE_SECRET', 'PLG_FIRESTORE_PROJECT', 'PLG_FIRESTORE_DATABASE',
      'PLG_ATTEMPT_MAIL_CREDENTIAL_SECRET', 'PLG_OWNER_SOURCE_SECRET']) expect(env[forbidden]).toBeUndefined();
    expect(env.REQUIRE_AUTH.value).toBe('true');
    expect(env.ALLOW_PUBLIC_DASHBOARD.value).toBe('false');
  });

  it('rejects production, mutable/unrelated images, unpinned keys and ambiguous read activation', () => {
    expect(() => environmentService(input('production'))).toThrow();
    expect(() => environmentService({ ...input(), image: image.replace('@sha256:', ':') })).toThrow();
    expect(() => environmentService({ ...input(), image: image.replace('hushh-pda-dev', 'hushh-ai-prod') })).toThrow();
    expect(() => environmentService({ ...input(), source: 'main' })).toThrow();
    expect(() => environmentService({ ...input(), versions: { ...versions, 'metrics-dashboard-session-secret': 'latest' } })).toThrow();
    expect(() => environmentService({ ...input(), versions: { ...versions, 'unexpected-key': '1' } })).toThrow();
    // @ts-expect-error Exercise a malformed runtime configuration, not a typed caller.
    expect(() => environmentService({ ...input(), readEnabled: 'true' })).toThrow();
  });

  it('promotes only the same-source immutable image from a completed canonical Dev run', () => {
    const run = { id: 123, repository: { full_name: 'hushh-labs/hussh-matrix-dashboard' },
      path: '.github/workflows/deploy-main.yml', event: 'workflow_dispatch', head_branch: 'main',
      status: 'completed', conclusion: 'success' };
    const receipt = { environment: 'dev', project: 'hushh-pda-dev', source, image, workflowRun: '123',
      runtimeVerified: true, origin: environmentTarget('dev').origin };
    expect(devRuntimeImage(run, receipt, source, '123')).toBe(image);
    expect(() => devRuntimeImage({ ...run, conclusion: 'failure' }, receipt, source, '123')).toThrow();
    expect(() => devRuntimeImage({ ...run, head_branch: 'feature' }, receipt, source, '123')).toThrow();
    for (const patch of [{ source: 'c'.repeat(40) }, { workflowRun: '124' }, { environment: 'uat' },
      { runtimeVerified: false }, { image: image.replace('hushh-pda-dev', 'hushh-ai-prod') }])
      expect(() => devRuntimeImage(run, { ...receipt, ...patch }, source, '123')).toThrow();
  });

  it('requires all exact-head canonical CI jobs; queued, skipped and missing jobs cannot pass', () => {
    const run = { repository: { full_name: 'hushh-labs/hussh-matrix-dashboard' }, path: '.github/workflows/responsive-ui.yml',
      event: 'pull_request', head_sha: source, status: 'completed', conclusion: 'success' };
    const jobs = { total_count: 3, jobs: ['verify', 'verify-plg-storage', 'verify-plg-infrastructure'].map(name =>
      ({ name, status: 'completed', conclusion: 'success' })) };
    expect(() => assertSourceCi(run, jobs, source)).not.toThrow();
    expect(() => assertSourceCi({ ...run, head_sha: 'c'.repeat(40) }, jobs, source)).toThrow();
    expect(() => assertSourceCi({ ...run, status: 'queued' }, jobs, source)).toThrow();
    expect(() => assertSourceCi({ ...run, path: '.github/workflows/other.yml' }, jobs, source)).toThrow();
    expect(() => assertSourceCi(run, { ...jobs, jobs: jobs.jobs.slice(1) }, source)).toThrow();
    expect(() => assertSourceCi(run, { ...jobs, jobs: jobs.jobs.map(j => ({ ...j, conclusion: 'skipped' })) }, source)).toThrow();
  });

  it('detects native image, identity, secret and unexpected production configuration drift', () => {
    const expected = environmentService(input());
    const revision = { metadata: { labels: expected.metadata.labels }, spec: structuredClone(expected.spec.template.spec),
      status: { conditions: [{ type: 'Ready', status: 'True' }] } };
    expect(() => assertEnvironmentRevision(revision, expected)).not.toThrow();
    for (const change of [
      r => { r.spec.containers[0].image = image.replace('b'.repeat(64), 'c'.repeat(64)); },
      r => { r.spec.serviceAccountName = 'other@hushh-pda-dev.iam.gserviceaccount.com'; },
      r => { r.spec.containers[0].env[0].valueFrom.secretKeyRef.key = 'latest'; },
      r => { r.spec.containers[0].env.push({ name: 'PLG_ONE_SOURCE_SECRET', value: 'borrowed' }); },
      r => { r.status.conditions[0].status = 'False'; },
    ]) {
      const changed = structuredClone(revision); change(changed);
      expect(() => assertEnvironmentRevision(changed, expected)).toThrow();
    }
  });
});
