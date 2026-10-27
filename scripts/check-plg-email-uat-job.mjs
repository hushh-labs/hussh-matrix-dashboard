/** Fixed renderer-job boundary. Reads supplied receipts; never calls cloud APIs. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const EMAIL_UAT = Object.freeze({
  project: 'hushh-ai-prod', namespace: '1072839345524', region: 'us-central1', job: 'matrix-plg-email-uat',
  runtime: 'matrix-plg-email-uat@hushh-ai-prod.iam.gserviceaccount.com',
  imagePrefix: 'us-central1-docker.pkg.dev/hushh-ai-prod/website-images/hushh-matrix-dashboard@sha256:',
  disabled: ['PLG_ENABLED', 'PLG_DELIVERY_ENABLED', 'PLG_GOOGLE_MAIL_ENABLED', 'PLG_GOOGLE_MAIL_CAMPAIGNS_ENABLED'],
});
const requireSafe = (condition, code) => { if (!condition) throw new Error(`plg_email_uat_${code}`); };
const empty = (value) => value === undefined || (Array.isArray(value) && value.length === 0);
const validImage = (value) => typeof value === 'string' && value.startsWith(EMAIL_UAT.imagePrefix) &&
  /^[a-f0-9]{64}$/.test(value.slice(EMAIL_UAT.imagePrefix.length));

function annotations(metadata) {
  for (const [key, value] of Object.entries(metadata?.annotations ?? {})) {
    requireSafe(!/cloudsql|vpc-access|network-interfaces|secrets|base-images|container-dependencies|breakglass/i.test(key), 'external_binding');
    requireSafe(!/invoker-iam-disabled/i.test(key) || value === 'false', 'public_access');
  }
}

function executionSpec(spec, image) {
  requireSafe(spec?.taskCount === 1 && spec.parallelism === 1, 'task_count');
  annotations(spec.template?.metadata);
  const task = spec.template?.spec;
  requireSafe(task?.serviceAccountName === EMAIL_UAT.runtime, 'runtime_identity');
  requireSafe(task.maxRetries === 0 && String(task.timeoutSeconds) === '120', 'retry_or_timeout');
  requireSafe(empty(task.volumes) && !task.nodeSelector, 'volume_or_accelerator');
  requireSafe(Array.isArray(task.containers) && task.containers.length === 1, 'container_count');
  const container = task.containers[0];
  requireSafe(validImage(container.image) && (!image || container.image === image), 'image');
  requireSafe(JSON.stringify(container.command) === '["npm"]' && JSON.stringify(container.args) === '["run","test:uat:plg-email"]', 'entrypoint');
  requireSafe(!container.workingDir || container.workingDir === '/app', 'working_directory');
  requireSafe(empty(container.volumeMounts) && empty(container.ports) && !container.startupProbe && !container.livenessProbe && !container.sandboxLauncher, 'container_binding');
  requireSafe(Array.isArray(container.env) && container.env.length === EMAIL_UAT.disabled.length, 'environment');
  const names = new Set();
  for (const entry of container.env) {
    requireSafe(EMAIL_UAT.disabled.includes(entry.name) && entry.value === 'false' && !entry.valueFrom &&
      Object.keys(entry).every((key) => ['name', 'value'].includes(key)) && !names.has(entry.name), 'environment');
    names.add(entry.name);
  }
}

export function assertEmailUatJob(job, policy, image) {
  requireSafe(job?.apiVersion === 'run.googleapis.com/v1' && job.kind === 'Job', 'job_schema');
  const metadata = job.metadata;
  requireSafe(metadata?.name === EMAIL_UAT.job && metadata.namespace === EMAIL_UAT.namespace && !metadata.deletionTimestamp, 'job_identity');
  requireSafe(typeof metadata.uid === 'string' && /^[a-z0-9-]{10,100}$/.test(metadata.uid), 'job_uid');
  requireSafe(metadata.labels?.purpose === 'plg-email-uat' && metadata.labels['managed-by'] === 'metrics-release' &&
    metadata.labels['cloud.googleapis.com/location'] === EMAIL_UAT.region, 'ownership');
  annotations(metadata); annotations(job.spec?.template?.metadata);
  requireSafe(!job.spec?.startExecutionToken && !job.spec?.runExecutionToken, 'implicit_execution');
  requireSafe(Number.isSafeInteger(Number(metadata.generation)) && Number(metadata.generation) > 0 &&
    Number(job.status?.observedGeneration) === Number(metadata.generation) &&
    job.status?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True'), 'job_ready');
  requireSafe(policy && typeof policy === 'object' && !Array.isArray(policy), 'iam_receipt');
  requireSafe(Array.isArray(policy.bindings ?? []), 'iam_receipt');
  for (const binding of policy.bindings ?? []) {
    requireSafe(Array.isArray(binding.members) && !binding.members.some((m) => ['allUsers', 'allAuthenticatedUsers'].includes(m)), 'public_access');
  }
  if (image) requireSafe(validImage(image), 'image');
  executionSpec(job.spec?.template?.spec, image);
  return { ok: true, scope: 'isolated-email-renderer', stage: 'job-policy' };
}

export function assertEmailUatExecution(execution, job, policy, image, startedAt, accepted) {
  assertEmailUatJob(job, policy, image);
  requireSafe(execution?.apiVersion === 'run.googleapis.com/v1' && execution.kind === 'Execution', 'execution_schema');
  const metadata = execution.metadata;
  requireSafe(metadata?.namespace === EMAIL_UAT.namespace &&
    new RegExp(`^${EMAIL_UAT.job}-[a-z0-9-]+$`).test(metadata.name) && !metadata.deletionTimestamp, 'execution_identity');
  requireSafe(typeof metadata.uid === 'string' && /^[a-z0-9-]{10,100}$/.test(metadata.uid) &&
    metadata.uid === accepted?.metadata?.uid && metadata.name === accepted.metadata.name &&
    metadata.namespace === accepted.metadata.namespace, 'execution_uid');
  requireSafe(metadata.labels?.['run.googleapis.com/job'] === EMAIL_UAT.job && metadata.ownerReferences?.some((owner) =>
    owner.kind === 'Job' && owner.name === EMAIL_UAT.job && owner.uid === job.metadata.uid && owner.controller === true), 'execution_owner');
  const start = Date.parse(startedAt), created = Date.parse(metadata.creationTimestamp);
  requireSafe(Number.isFinite(start) && start >= Date.now() - 600_000 && start <= Date.now() + 60_000 &&
    Number.isFinite(created) && created >= start - 30_000 && created <= Date.now() + 60_000, 'execution_time');
  annotations(metadata);
  executionSpec(execution.spec, image);
  const status = execution.status;
  requireSafe(status?.conditions?.some((c) => c.type === 'Completed' && c.status === 'True') && status.succeededCount === 1 &&
    ['failedCount', 'cancelledCount', 'retriedCount', 'runningCount'].every((key) => (status[key] ?? 0) === 0) &&
    Number.isFinite(Date.parse(status.completionTime)) && Date.parse(status.completionTime) >= created - 30_000,
  'execution_not_successful');
  return { ok: true, scope: 'isolated-email-renderer', stage: 'execution',
    executionName: metadata.name, executionUid: metadata.uid, succeededTasks: 1, retries: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2), read = (path) => JSON.parse(readFileSync(path, 'utf8'));
    let report;
    if (args[0] === 'job' && [3, 4].includes(args.length)) report = assertEmailUatJob(read(args[1]), read(args[2]), args[3]);
    else if (args[0] === 'execution' && args.length === 7)
      report = assertEmailUatExecution(read(args[1]), read(args[2]), read(args[3]), args[4], args[5], read(args[6]));
    else throw new Error('plg_email_uat_arguments');
    console.log(JSON.stringify(report));
  } catch {
    console.error(JSON.stringify({ ok: false, scope: 'isolated-email-renderer', stage: 'job-boundary' }));
    process.exitCode = 1;
  }
}
