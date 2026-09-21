#!/usr/bin/env node

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  if (flag === '--base-url') return args.find((arg) => /^https?:\/\//.test(arg)) || fallback;
  return fallback;
};

const baseUrl = valueAfter('--base-url', process.env.METRICS_DASHBOARD_URL || 'https://metrics.hushh.ai').replace(/\/$/, '');
const timeoutMs = Number(valueAfter('--timeout-ms', process.env.METRICS_CONTRACT_TIMEOUT_MS || '120000'));
const days = Math.max(1, Number(valueAfter('--days', '7')) || 7);
const maxOneBytes = Number(valueAfter('--max-one-bytes', '750000'));
const maxAllBytes = Number(valueAfter('--max-all-bytes', '2500000'));

const end = new Date();
end.setUTCHours(0, 0, 0, 0);
const start = new Date(end);
start.setUTCDate(start.getUTCDate() - (days - 1));
const date = (value) => value.toISOString().slice(0, 10);
const query = new URLSearchParams({ startDate: date(start), endDate: date(end) });

const forbiddenKeys = new Set([
  'identities',
  'featureuseridentities',
  'userpseudoid',
  'user_pseudo_id',
  'userid',
  'user_id',
  'displayname',
  'boundemail',
  'email',
  'phonenumber',
  'phone',
  'paramname',
  'paramphone',
  'humanusers',
  'humanevents',
]);
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const phonePattern = /(?:^|\s)\+\d[\d\s().-]{8,}\d(?:$|\s)/;
const rawConfigPattern = /GCP_SERVER_ACTOR_UID|[A-Z][A-Z0-9_]{3,}\s+is required/i;

function inspect(value, path, findings) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspect(item, `${path}[${index}]`, findings));
    return;
  }
  if (typeof value === 'string') {
    if (emailPattern.test(value)) findings.push(`${path}: email-like value`);
    if (phonePattern.test(value)) findings.push(`${path}: phone-like value`);
    if (value.startsWith('reg_')) findings.push(`${path}: synthetic registered identity`);
    if (rawConfigPattern.test(value)) findings.push(`${path}: raw configuration detail`);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (forbiddenKeys.has(key.toLowerCase())) findings.push(`${childPath}: forbidden person-level field`);
    inspect(child, childPath, findings);
  }
}

function assertOneSummary(summary, label, expectedWebHost, findings) {
  if (!summary || typeof summary !== 'object' || summary.available === false) return;
  if (summary.sourceWebHost !== expectedWebHost) findings.push(`${label}.sourceWebHost: expected ${expectedWebHost}`);
  if (summary.surfaceScope?.webHost !== expectedWebHost || summary.surfaceScope?.strictWebHost !== true) {
    findings.push(`${label}.surfaceScope: exact web-host isolation is not declared`);
  }
  const active = summary.activeUsers;
  if (!active || active.countingUnit !== 'device') findings.push(`${label}.activeUsers.countingUnit: expected device`);
  if (!active?.identityScope || !/device|browser/i.test(active.identityScope)) findings.push(`${label}.activeUsers.identityScope: missing device scope`);
  const dau = Number(active?.dau ?? 0);
  const wau = Number(active?.wau ?? 0);
  const mau = Number(active?.mau ?? 0);
  if (!(dau <= wau && wau <= mau)) findings.push(`${label}.activeUsers: expected DAU <= WAU <= MAU, got ${dau}/${wau}/${mau}`);
  for (const [index, capability] of (summary.capabilities || []).entries()) {
    if (!Object.hasOwn(capability, 'devices')) findings.push(`${label}.capabilities[${index}].devices: missing device count`);
    if (!Object.hasOwn(capability, 'deliberateEvents')) findings.push(`${label}.capabilities[${index}].deliberateEvents: missing event count`);
  }
  for (const [funnelIndex, funnel] of (summary.installFunnel || []).entries()) {
    const stages = funnel?.stages || [];
    for (let index = 1; index < stages.length; index += 1) {
      const previous = Number(stages[index - 1]?.users ?? 0);
      const current = Number(stages[index]?.users ?? 0);
      if (current > previous) {
        findings.push(`${label}.installFunnel[${funnelIndex}]: stage ${index} rises from ${previous} to ${current}`);
      }
    }
  }
}

async function fetchJson(path, maxBytes) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}?${query}`, { signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    if (Buffer.byteLength(text) > maxBytes) throw new Error(`${path} payload ${Buffer.byteLength(text)} bytes exceeds ${maxBytes}`);
    return { data: JSON.parse(text), bytes: Buffer.byteLength(text), durationMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

const checks = [];
const failures = [];
for (const spec of [
  { path: '/api/analytics/one', maxBytes: maxOneBytes },
  { path: '/api/analytics/all', maxBytes: maxAllBytes },
]) {
  try {
    const result = await fetchJson(spec.path, spec.maxBytes);
    const findings = [];
    inspect(result.data, '$', findings);
    const one = spec.path.endsWith('/one') ? result.data?.data : result.data?.one?.data;
    assertOneSummary(one?.production, `${spec.path}.production`, 'one.hushh.ai', findings);
    assertOneSummary(one?.uat, `${spec.path}.uat`, 'uat.one.hushh.ai', findings);
    checks.push({ endpoint: spec.path, bytes: result.bytes, durationMs: result.durationMs, findings: findings.length });
    failures.push(...findings.map((finding) => `${spec.path} ${finding}`));
  } catch (error) {
    failures.push(`${spec.path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const report = {
  ok: failures.length === 0,
  baseUrl,
  range: { startDate: date(start), endDate: date(end), days },
  checks,
  failures,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
