/** Scheduler entrypoint. Sync and delivery each require an explicit flag. */
import { config } from 'dotenv';
import { createHmac } from 'node:crypto';
import { PLG_SYNC_REQUEST_TIMEOUT_MS } from '../src/lib/plg-budgets.mjs';
config({ path: '.env.local', quiet: true });
const origin = process.env.PLG_PUBLIC_ORIGIN;
const secret = process.env.PLG_SIGNING_SECRET;
const syncSecret = process.env.PLG_SYNC_SECRET;
const cycleSecret = process.env.PLG_CYCLE_SECRET;
const cycle = process.argv.includes('--cycle');
const attempts = process.argv.includes('--attempts');
const attemptSecret = process.env.PLG_ATTEMPT_WORKER_SECRET;
const attemptLane = process.env.PLG_ATTEMPT_ENVIRONMENT;
const send = process.argv.includes('--send');
const sync = process.argv.includes('--sync-only') || process.argv.includes('--sync-first');
if (
  !origin ||
  (send && (!secret || secret.length < 32)) ||
  (cycle && (!cycleSecret || cycleSecret.length < 32)) ||
  (sync && (!syncSecret || syncSecret.length < 32)) ||
  (!send && !sync && !cycle && !attempts) ||
  (cycle && (send || sync || attempts)) ||
  (attempts && (send || sync || !['uat', 'production'].includes(attemptLane) || !attemptSecret || attemptSecret.length < 32))
) {
  console.error(
    'Use --cycle for campaign sync/delivery, --sync-only for source reads, or --attempts with its separate environment and worker key. Do not combine delivery modes.',
  );
  process.exitCode = 1;
} else {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('The delivery scheduler requires a clean HTTPS origin.');
  const invoke = async (purpose) => {
    const timestamp = String(Date.now()),
      body = '{}';
    const signature = createHmac('sha256', purpose === 'attempts' ? attemptSecret : purpose === 'sync' ? syncSecret : purpose === 'cycle' ? cycleSecret : secret)
      .update(`${purpose === 'attempts' ? `attempt-cycle.${attemptLane}` : purpose}\n${timestamp}\n${body}`)
      .digest('hex');
    const response = await fetch(new URL(`/integrations/plg/${purpose}`, url), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(purpose === 'sync' ? PLG_SYNC_REQUEST_TIMEOUT_MS : 240_000),
      headers: {
        'Content-Type': 'application/json',
        'X-PLG-Timestamp': timestamp,
        'X-PLG-Signature': signature,
      },
      body,
    });
    if (!response.ok) throw new Error('Worker rejected');
    return response.json();
  };
  try {
    if (attempts) {
      const result = await invoke('attempts');
      console.log(JSON.stringify({ accepted: result.accepted, uncertain: result.uncertain, deferred: result.deferred }));
    }
    if (cycle) {
      const result = await invoke('cycle');
      console.log(JSON.stringify({ status: result.status, accounts: result.accounts, sent: result.sent, uncertain: result.uncertain }));
    }
    if (sync) {
      const result = await invoke('sync');
      console.log(
        JSON.stringify({
          accounts: result.accounts,
          imported: result.imported,
          erased: result.erased,
        }),
      );
    }
    if (send) {
      const result = await invoke('run');
      console.log(JSON.stringify({ sent: result.sent, uncertain: result.uncertain }));
    }
  } catch {
    console.error(
      'PLG worker did not confirm success. Check the private delivery history before retrying.',
    );
    process.exitCode = 1;
  }
}
