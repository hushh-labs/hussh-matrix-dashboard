/** Scheduler entrypoint. Preview is the default; --send explicitly opts in. */
import { config } from 'dotenv';
import { createHmac } from 'node:crypto';
config({ path: '.env.local', quiet: true });
const origin = process.env.PLG_PUBLIC_ORIGIN;
const secret = process.env.PLG_SIGNING_SECRET;
if (!origin || !secret || secret.length < 32 || !process.argv.includes('--send')) {
  console.error(
    'No email was sent. Use the private workspace to preview. The scheduler requires PLG_PUBLIC_ORIGIN, a secret-backed PLG_SIGNING_SECRET, and --send.',
  );
  process.exitCode = 1;
} else {
  const url = new URL('/integrations/plg/run', origin);
  if (url.protocol !== 'https:') throw new Error('The delivery scheduler requires HTTPS.');
  const timestamp = String(Date.now()),
    body = '{}';
  const signature = createHmac('sha256', secret).update(`run\n${timestamp}\n${body}`).digest('hex');
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(180_000),
      headers: {
        'Content-Type': 'application/json',
        'X-PLG-Timestamp': timestamp,
        'X-PLG-Signature': signature,
      },
      body,
    });
    if (!response.ok) throw new Error('Worker rejected');
    const result = await response.json();
    console.log(JSON.stringify({ sent: result.sent, uncertain: result.uncertain }));
  } catch {
    console.error('PLG worker did not confirm success. Check the private delivery history before retrying.');
    process.exitCode = 1;
  }
}
