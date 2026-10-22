import { GoogleAuth } from 'google-auth-library';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plgSteps, type PlgStep } from '../src/lib/plg';
import { initialPlgState } from '../src/server/plg/engine';

const project = 'hushh-ai-prod';
const sender = 'One PLG testing <onboarding@resend.dev>';
const email = /^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
class SelfTestError extends Error {}
let phase = 'arguments';

/** Fixed preview fixtures: no production audience, enrollments or measurements. */
export function selfTestMessages(recipient: string, replyTo: string, step: string) {
  if (!email.test(recipient) || !email.test(replyTo)) throw new Error('Invalid test mailbox configuration');
  if (step !== 'all' && !plgSteps.includes(step as PlgStep)) throw new Error('Choose an existing journey step');
  return initialPlgState().templates.filter((t) => t.journey === 'memory' && (step === 'all' || t.step === step)).map((t) => ({
    from: sender,
    to: [recipient],
    reply_to: replyTo,
    subject: `[TEST · ${t.step.toUpperCase()}] ${t.subject}`,
    text: `PLG TEST PREVIEW — ${t.step}\n\nThis is a requested test of draft content. It does not assess your activity, enroll you in campaigns, or change customer metrics.\n\n${t.body}\n\n${t.ctaLabel}: ${t.ctaUrl}\n\nThis isolated test does not subscribe you to automatic marketing emails. Production preference and unsubscribe links require a real permission-backed enrollment and are not fabricated in this preview.`,
    tags: [{ name: 'plg_test_step', value: t.step }],
  }));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--send', '--preview'].includes(arg) && !/^--(?:step|run-id|output)=/.test(arg))) throw new SelfTestError('Unsupported argument; recipients come only from Secret Manager');
  const send = args.includes('--send');
  if (send === args.includes('--preview')) throw new SelfTestError('Choose exactly one of --preview or --send');
  const runId = args.find((a) => a.startsWith('--run-id='))?.slice(9);
  if (!runId || !/^[a-zA-Z0-9_-]{8,80}$/.test(runId)) throw new SelfTestError('Supply a stable --run-id for provider deduplication');
  const step = args.find((a) => a.startsWith('--step='))?.slice(7) ?? 'welcome';
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  async function secret(name: string) {
    phase = `read ${name}`;
    const result = await client.request<{ payload: { data: string } }>({ url: `https://secretmanager.googleapis.com/v1/projects/${project}/secrets/${name}/versions/latest:access` });
    return Buffer.from(result.data.payload.data, 'base64').toString('utf8').trim();
  }
  const recipient = await secret('metrics-one-plg-test-recipient');
  const replyTo = await secret('metrics-one-plg-reply-to');
  const messages = selfTestMessages(recipient, replyTo, step);
  // Test credentials must never make the customer transport live.
  phase = 'verify deployed customer delivery is disabled';
  const service = await client.request<any>({ url: `https://run.googleapis.com/v2/projects/${project}/locations/us-central1/services/hushh-matrix-dashboard` });
  const env = service.data.template?.containers?.[0]?.env ?? [];
  if (env.find((v: any) => v.name === 'PLG_DELIVERY_ENABLED')?.value !== 'false') throw new SelfTestError('This self-test requires customer delivery to remain disabled');
  const receipt = { runId, recipientHash: hash(recipient.toLowerCase()), customerEnrollmentChanged: false, campaignMetricsChanged: false, providerAccepted: [] as { step: string; id: string }[], previewCount: messages.length };
  if (send) {
    const key = await secret('metrics-one-plg-resend-api-key');
    for (const message of messages) {
      const testStep = message.tags[0].value;
      phase = `provider acceptance for ${testStep}`;
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `plg-self-test-${runId}-${testStep}` },
        body: JSON.stringify(message),
      });
      const result = await response.json() as { id?: string };
      if (!response.ok || !result.id) throw new SelfTestError(`Provider acceptance is unconfirmed (HTTP ${response.status}). Inspect Resend before retrying; no automatic retry was attempted`);
      receipt.providerAccepted.push({ step: testStep, id: result.id });
      console.log(JSON.stringify({ step: testStep, providerAccepted: true, delivered: 'not_yet_verified' }));
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
  }
  const output = args.find((a) => a.startsWith('--output='))?.slice(9);
  if (output) await writeFile(output, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(JSON.stringify({ error: 'PLG self-test did not confirm completion', phase, reason: error instanceof SelfTestError ? error.message : 'Check authorized configuration and private provider history', httpStatus: error?.response?.status })); process.exitCode = 1; });
}
