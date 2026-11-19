import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const script = 'scripts/check-agent-signal-coverage.mjs';
it.each([[[]], [['--cli']], [['--repeat','3']], [['--execute']], [['--inventory-only','--cli']],
  [['--inventory-only','--repeat','3']], [['--inventory-only','--start-date','2026-01-01']],
  [['--inventory-only','--dashboard-url','https://example.test']], [['--inventory-only','--inventory-only']],
  [['--inventory-only','--app-repo']], [['--inventory-only','--app-ref','HEAD']]])('rejects unsafe or invalid options %j', args => {
 const result=spawnSync(process.execPath,[script,...args],{encoding:'utf8',env:{...process.env,BQ_JOB_PROJECT:'synthetic'}});
 expect(result.status).not.toBe(0);
});
it('provides only offline inventory when explicitly requested',()=>{
 const result=spawnSync(process.execPath,[script,'--inventory-only'],{encoding:'utf8'});
 expect(result.status).toBe(0);const output=JSON.parse(result.stdout);
 expect(output.mode).toBe('offline_inventory');expect(output.sourceStatus).toBe('source_repository_not_supplied');
 expect(output.sourceEvidence).toBeNull();expect(output).not.toHaveProperty('runs');
});
it('has no BigQuery, CLI query or dashboard network execution path',()=>{
 const code=readFileSync(script,'utf8');
 expect(code).not.toMatch(/@google-cloud\/bigquery|new\s+BigQuery|\bfetch\s*\(|run\(['"]bq['"]/);
});
