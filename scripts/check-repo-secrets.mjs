#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PLACEHOLDER_VALUES = new Set([
  '',
  'changeme',
  'change_me',
  'example',
  'false',
  'placeholder',
  'true',
]);

const PATTERNS = [
  {
    name: 'private-key-block',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  {
    name: 'google-api-key',
    regex: /AIza[0-9A-Za-z_-]{35}/g,
  },
  {
    name: 'github-token',
    regex: /gh[pousr]_[0-9A-Za-z_]{36,}/g,
  },
  {
    name: 'supabase-management-token',
    regex: /sbp_[0-9A-Za-z_-]{20,}/g,
  },
];

const SECRET_ASSIGNMENT =
  /^\s*(?:export\s+)?([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*(['"]?)([^'"\s#]+)\2/gm;

function repoFiles() {
  const output = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  });
  return output.split('\0').filter(Boolean);
}

function isProbablyText(content) {
  return !content.includes('\0');
}

function isPlaceholder(value) {
  const normalized = value.trim().replace(/^['"]|['"]$/g, '');
  const lower = normalized.toLowerCase();
  return (
    PLACEHOLDER_VALUES.has(lower) ||
    normalized.startsWith('$') ||
    normalized.startsWith('<') ||
    normalized.startsWith('MY_') ||
    normalized.startsWith('YOUR_') ||
    lower.includes('example') ||
    lower.includes('placeholder')
  );
}

function lineNumberForIndex(content, index) {
  return content.slice(0, index).split('\n').length;
}

const findings = [];
const files = repoFiles();

for (const file of files) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  if (!isProbablyText(content)) continue;

  for (const pattern of PATTERNS) {
    for (const match of content.matchAll(pattern.regex)) {
      findings.push({
        file,
        line: lineNumberForIndex(content, match.index ?? 0),
        rule: pattern.name,
      });
    }
  }

  for (const match of content.matchAll(SECRET_ASSIGNMENT)) {
    const [, name, , value] = match;
    if (isPlaceholder(value)) continue;
    findings.push({
      file,
      line: lineNumberForIndex(content, match.index ?? 0),
      rule: `non-placeholder-secret-assignment:${name}`,
    });
  }
}

const result = {
  ok: findings.length === 0,
  checkedAt: new Date().toISOString(),
  scanned: files.length,
  findings,
};

console.log(JSON.stringify(result, null, 2));

if (findings.length > 0) process.exit(1);
