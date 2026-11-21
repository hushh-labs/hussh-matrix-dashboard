import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { retainedNames } from './lib/metrics-retained-report-settings.mjs';

const resource = JSON.parse(readFileSync(0, 'utf8'));
const expectedImage = process.argv[2];
const containers = expectedImage ? resource.spec?.containers : resource.spec?.template?.spec?.containers;
assert(Array.isArray(containers) && containers.length === 1, 'Expected one dashboard container.');
const [container] = containers;
if (expectedImage) assert(container.image === expectedImage, 'Release candidate image does not match the reviewed digest.');
const env = container.env ?? [];
assert(Array.isArray(env), 'Dashboard runtime environment is unreadable.');
const flags = env.filter(entry => entry.name === 'METRICS_BIGQUERY_ENABLED');
assert(flags.length === 0 || (flags.length === 1 && flags[0].value === 'false' && !flags[0].valueFrom),
  'Release requires BigQuery disabled in the dashboard runtime.');
// The deploy preserves inherited environment entries. A plain retained-report
// value will fail the existing runtime verification after the paid build.
if (!expectedImage) {
  const inheritedPlain = env.filter(entry => entry.value && retainedNames.includes(entry.name)).map(entry => entry.name);
  assert(inheritedPlain.length === 0, `Bind retained report settings before building: ${inheritedPlain.join(', ')}.`);
}
console.log('Dashboard runtime configuration: BigQuery disabled.');
