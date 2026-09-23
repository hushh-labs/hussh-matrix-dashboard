#!/usr/bin/env node
/** Mint a short-lived, synthetic QA session for trusted release probes only. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const secret = process.env.SESSION_SECRET || '';
assert(secret.length >= 32, 'SESSION_SECRET must be provided securely to the release job');
const session = JSON.stringify({
  email: 'metrics-release-probe@hushh.ai',
  name: 'Metrics release probe',
  picture: '',
  exp: Math.floor(Date.now() / 1000) + 30 * 60,
});
const signature = crypto.createHmac('sha256', secret).update(session).digest('base64url');
process.stdout.write(`hussh_matrix_session=${encodeURIComponent(`s:${session}.${signature}`)}`);
