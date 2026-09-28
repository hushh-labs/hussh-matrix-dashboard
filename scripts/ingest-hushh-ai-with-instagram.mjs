#!/usr/bin/env node
// Replacement command for the EXISTING Hushh AI Search Console Cloud Run Job.
// It keeps the original ingestion exit status, then attempts Instagram once
// per UTC day if enabled. This creates no additional Scheduler job.
import { spawn } from 'node:child_process';

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', shell: false });
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

const searchStatus = await run(['scripts/ingest-hushhtech-search-console.mjs', ...process.argv.slice(2)]);
if (process.env.INSTAGRAM_ANALYTICS_ENABLED === 'true') {
  const instagramStatus = await run(['node_modules/tsx/dist/cli.mjs', 'scripts/ingest-instagram.ts', '--scheduled']);
  if (instagramStatus !== 0) process.stderr.write('Instagram daily sync did not complete; Search Console status is unchanged.\n');
}
process.exitCode = searchStatus;
