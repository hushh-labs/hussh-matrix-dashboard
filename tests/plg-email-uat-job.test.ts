import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertEmailUatJob, assertEmailUatExecution, EMAIL_UAT } from '../scripts/check-plg-email-uat-job.mjs';

const image = `${EMAIL_UAT.imagePrefix}${'a'.repeat(64)}`;
const now = new Date().toISOString();
const policy = { bindings: [{ role: 'roles/run.invoker', members: ['serviceAccount:github-actions-deployer@hushh-ai-prod.iam.gserviceaccount.com'] }] };
const fixture = (): any => ({ apiVersion: 'run.googleapis.com/v1', kind: 'Job',
  metadata: { name: EMAIL_UAT.job, namespace: EMAIL_UAT.namespace, uid: '00000000-0000-4000-8000-000000000001', generation: 2,
    labels: { purpose: 'plg-email-uat', 'managed-by': 'metrics-release', 'cloud.googleapis.com/location': EMAIL_UAT.region } },
  spec: { template: { metadata: {}, spec: { taskCount: 1, parallelism: 1, template: { spec: {
    serviceAccountName: EMAIL_UAT.runtime, maxRetries: 0, timeoutSeconds: '120', containers: [{ image,
      command: ['npm'], args: ['run', 'test:uat:plg-email'], env: EMAIL_UAT.disabled.map((name) => ({ name, value: 'false' })) }],
  } } } } }, status: { observedGeneration: 2, conditions: [{ type: 'Ready', status: 'True' }] } });
const execution = (job: any): any => ({ apiVersion: 'run.googleapis.com/v1', kind: 'Execution',
  metadata: { name: `${EMAIL_UAT.job}-run001`, namespace: EMAIL_UAT.namespace, creationTimestamp: now,
    uid: '10000000-0000-4000-8000-000000000001',
    labels: { 'run.googleapis.com/job': EMAIL_UAT.job }, ownerReferences: [{ kind: 'Job', name: EMAIL_UAT.job, uid: job.metadata.uid, controller: true }] },
  spec: structuredClone(job.spec.template.spec), status: { conditions: [{ type: 'Completed', status: 'True' }], succeededCount: 1, completionTime: now } });

describe('isolated email-renderer job boundary', () => {
  it('admits only the owned private job and its successful exact-image execution', () => {
    const job = fixture();
    expect(assertEmailUatJob(job, policy, image).ok).toBe(true);
    const accepted = execution(job);
    expect(assertEmailUatExecution(structuredClone(accepted), job, policy, image, now, accepted)).toMatchObject({
      succeededTasks: 1, executionUid: accepted.metadata.uid, executionName: accepted.metadata.name });
  });
  it.each([
    (j: any) => { j.metadata.namespace = 'other-project'; },
    (j: any) => { j.metadata.labels.purpose = 'customer-worker'; },
    (j: any) => { j.spec.template.spec.template.spec.serviceAccountName = 'metrics-dashboard-runtime@hushh-ai-prod.iam.gserviceaccount.com'; },
    (j: any) => { j.spec.template.spec.taskCount = 2; },
    (j: any) => { j.spec.template.spec.template.spec.maxRetries = 1; },
    (j: any) => { j.spec.template.spec.template.spec.timeoutSeconds = '600'; },
    (j: any) => { j.spec.template.spec.template.spec.containers[0].image = image.replace('@sha256:', ':'); },
    (j: any) => { j.spec.template.spec.template.spec.containers[0].args = ['start']; },
    (j: any) => { j.spec.template.spec.template.spec.containers[0].env[0] = { name: 'DB_PASSWORD', valueFrom: { secretKeyRef: { name: 'not-for-uat' } } }; },
    (j: any) => { j.spec.template.spec.template.spec.volumes = [{ name: 'customer-records' }]; },
    (j: any) => { j.spec.template.metadata.annotations = { 'run.googleapis.com/cloudsql-instances': 'not-for-uat' }; },
    (j: any) => { j.spec.runExecutionToken = 'automatic-run'; },
    (j: any) => { j.status.observedGeneration = 1; },
  ])('refuses a changed execution/identity/data-access boundary', (change) => {
    const job = fixture(); change(job); expect(() => assertEmailUatJob(job, policy, image)).toThrow('plg_email_uat_');
  });
  it.each(['allUsers', 'allAuthenticatedUsers'])('refuses public IAM even with a condition', (member) => {
    expect(() => assertEmailUatJob(fixture(), { bindings: [{ members: [member], condition: { expression: 'true' } }] }, image)).toThrow('public_access');
  });
  it.each([
    (e: any) => { delete e.metadata.uid; },
    (e: any) => { e.metadata.uid = '20000000-0000-4000-8000-000000000001'; },
    (e: any) => { e.metadata.ownerReferences[0].uid = 'other-job-0000'; },
    (e: any) => { e.metadata.creationTimestamp = '2020-01-01T00:00:00Z'; },
    (e: any) => { e.spec.template.spec.containers[0].image = `${EMAIL_UAT.imagePrefix}${'b'.repeat(64)}`; },
    (e: any) => { e.status.conditions[0].status = 'False'; },
    (e: any) => { e.status.retriedCount = 1; },
  ])('refuses stale, unrelated, changed-image or failed execution evidence', (change) => {
    const job = fixture(), accepted = execution(job), run = structuredClone(accepted); change(run);
    expect(() => assertEmailUatExecution(run, job, policy, image, now, accepted)).toThrow('plg_email_uat_');
  });
  it('requires an immutable UID and matching name from the actual execute response', () => {
    const job = fixture(), observed = execution(job), accepted = structuredClone(observed);
    delete accepted.metadata.uid;
    expect(() => assertEmailUatExecution(observed, job, policy, image, now, accepted)).toThrow('execution_uid');
    accepted.metadata.uid = observed.metadata.uid; accepted.metadata.name = `${EMAIL_UAT.job}-other`;
    expect(() => assertEmailUatExecution(observed, job, policy, image, now, accepted)).toThrow('execution_uid');
  });
  it('keeps the renderer UAT gate before the production service mutation', () => {
    const workflow = readFileSync('.github/workflows/deploy-main.yml', 'utf8');
    const uat = workflow.indexOf('- name: Verify isolated email renderer in UAT job');
    expect(uat).toBeGreaterThan(workflow.indexOf('- name: Build container image'));
    expect(uat).toBeLessThan(workflow.indexOf('- name: Deploy Cloud Run service'));
  });
});
