import { runAttemptMailJob } from '../src/server/plg/attempt-mail-job';
import { AttemptMailCycleBusy } from '../src/server/plg/attempt-email-control';

// Private Cloud Run Job only. Its scheduler has run, never runWithOverrides.
// Errors deliberately omit provider bodies, addresses, grants and credentials.
try {
  if (process.argv.length !== 2) throw new Error('Arguments are not admitted.');
  const result = await runAttemptMailJob();
  console.log(JSON.stringify({ status: result.uncertain || result.deferred ? 'blocked' : 'completed', ...result }));
  if (result.uncertain || result.deferred) process.exitCode = 1;
} catch (error) {
  if (error instanceof AttemptMailCycleBusy) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'cycle_already_running' }));
  } else {
    console.error('Private attempt mail job did not confirm completion.');
    process.exitCode = 1;
  }
}
