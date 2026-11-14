import { open } from 'node:fs/promises';
import { runBigQueryPreflight } from './lib/metrics-bigquery-preflight';

// An operator supplies an ephemeral read-authorized access token in this
// process, never a command-line argument/file. No application flag is changed.
async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--output') throw new Error('arguments');
  const output = await open(process.argv[3], 'wx'); // refuse an existing receipt before any native call
  const accessToken = process.env.METRICS_BQ_PLANNING_ACCESS_TOKEN;
  delete process.env.METRICS_BQ_PLANNING_ACCESS_TOKEN;
  try {
    const receipt = await runBigQueryPreflight({ accessToken });
    await output.writeFile(JSON.stringify(receipt, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify(receipt));
    if (receipt.state !== 'estimated') process.exitCode = 1;
  } finally { await output.close(); }
}
main().catch(() => {
  console.error(JSON.stringify({ state: 'held', reason: 'operator_preflight_unavailable' }));
  process.exitCode = 1;
});
