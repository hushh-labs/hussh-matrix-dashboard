#!/usr/bin/env node
import { config as loadDotenvFile } from 'dotenv';
import { InstagramCredentials } from '../src/server/instagram/credentials';
import { BigQueryInstagramStore } from '../src/server/instagram/store';
import { syncInstagram } from '../src/server/instagram/sync';

// Explicit process settings win. Local values fill gaps before shared defaults.
loadDotenvFile({ path: '.env.local' });
loadDotenvFile({ path: '.env' });

async function main() {
  const credentials = new InstagramCredentials();
  const result = await syncInstagram({
    enabled: process.env.INSTAGRAM_ANALYTICS_ENABLED === 'true',
    accountId: process.env.INSTAGRAM_USER_ID || '',
    apiVersion: process.env.INSTAGRAM_GRAPH_API_VERSION || 'v26.0',
    loadToken: () => credentials.loadForSync(),
    store: new BigQueryInstagramStore(),
    scheduled: process.argv.includes('--scheduled'),
  });
  // Run IDs and coarse states only. Never print Meta/Secret Manager payloads.
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!['success', 'not_configured', 'already_running', 'already_synced_today'].includes(result.state)) process.exitCode = 1;
}

main().catch(() => {
  process.stderr.write('Instagram sync failed before completion. Check private service diagnostics.\n');
  process.exitCode = 1;
});
