import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
console.log('Dashboard runtime configuration: BigQuery disabled.');
