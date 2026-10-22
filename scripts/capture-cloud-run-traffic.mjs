/** Serialize the complete serving split for a reversible Cloud Run deploy. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function formatTrafficTargets(service) {
  const traffic = service?.status?.traffic;
  if (!Array.isArray(traffic)) throw new Error('Cloud Run traffic status is unavailable.');
  const serving = traffic.filter((entry) => Number(entry.percent) > 0);
  if (serving.length === 0) throw new Error('No serving Cloud Run revision was found.');
  const seen = new Set();
  let total = 0;
  const targets = serving.map((entry) => {
    const percent = Number(entry.percent);
    const revision = entry.revisionName;
    if (!Number.isInteger(percent) || percent < 1 || percent > 100
      || typeof revision !== 'string' || !/^[a-z][a-z0-9-]+$/.test(revision)
      || seen.has(revision)) {
      throw new Error('Cloud Run traffic status has an invalid serving revision.');
    }
    seen.add(revision);
    total += percent;
    return `${revision}=${percent}`;
  });
  if (total !== 100) throw new Error('Cloud Run traffic percentages do not total 100.');
  return targets.join(',');
}

/** A zero-traffic candidate must not undo an operator's newer traffic change. */
export function candidateNeedsRollback(service, previous, candidate) {
  const current = formatTrafficTargets(service);
  if (current === previous || !candidate) return false;
  return service.status.traffic.some(entry => entry.revisionName === candidate && Number(entry.percent) > 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const service = JSON.parse(input);
    process.stdout.write(process.argv.includes('--needs-rollback')
      ? String(candidateNeedsRollback(service, process.env.PREVIOUS_TRAFFIC, process.env.CANDIDATE_REVISION))
      : formatTrafficTargets(service));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Cannot capture Cloud Run traffic.');
    process.exitCode = 1;
  }
}
