#!/usr/bin/env node
/** Offline source inventory only. Live query reconciliation is disabled. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { AGENT_MEASUREMENTS } from '../src/lib/agent-measurement-contract.mjs';

const args = process.argv.slice(2);
if (!args.includes('--inventory-only')) {
  throw new Error('Live agent-signal audit is disabled: it lacks the shared durable BigQuery budget and recovery controls. Use --inventory-only for offline source inventory.');
}
let appRepo = null, appRef = 'HEAD';
const seen = new Set();
for (let i = 0; i < args.length; i++) {
  const name = args[i];
  if (!['--inventory-only', '--app-repo', '--app-ref'].includes(name) || seen.has(name)) throw new Error('Unsupported or duplicate inventory option');
  seen.add(name);
  if (name !== '--inventory-only') {
    const value = args[++i];
    if (!value || value.startsWith('-')) throw new Error('Missing or invalid inventory option value');
    if (name === '--app-repo') appRepo = value; else appRef = value;
  }
}
if (seen.has('--app-ref') && !appRepo) throw new Error('Source ref requires a source repository');
const run = promisify(execFile);
const panelSource = readFileSync(new URL('../src/components/AgentCapabilityAnalyticsPanel.tsx',import.meta.url),'utf8');
const displayedKeys = [...panelSource.matchAll(/(?:key:|actionSpec\()\s*'([a-z_]+)'/g)].map(m=>m[1]);
const missingContract = [...new Set(displayedKeys)].filter(key=>!AGENT_MEASUREMENTS.some(m=>m.key===key));
if(missingContract.length) throw new Error('Audit inventory missing displayed features: '+missingContract.join(', '));
// Read local event membership as configuration; no source counts are computed.
const serverSource=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
const catalogue=serverSource.match(/const ONE_CAPABILITIES: OneCapabilitySpec\[\] = \[([\s\S]*?)\n\];/)?.[1]??'';
const names=text=>[...text.matchAll(/'([a-z_]+)'/g)].map(match=>match[1]);
const capabilities=[...catalogue.matchAll(/\{\s*key: '([a-z_]+)',[\s\S]*?deliberate: \[([\s\S]*?)\],[\s\S]*?background: \[([\s\S]*?)\],[\s\S]*?instrumented: (true|false)/g)]
  .map(match=>({key:match[1],deliberate:names(match[2]),background:names(match[3]),instrumented:match[4]==='true'}));
if(capabilities.length!==12) throw new Error('Incomplete capability inventory');

async function sourceEvidence() {
  if(!appRepo) return null;
  const {stdout: sha} = await run('git',['rev-parse',appRef],{cwd:appRepo,timeout:30000,windowsHide:true});
  const evidence = {};
  // References identify candidate callers, not deployment or a completed journey.
  for(const measurement of AGENT_MEASUREMENTS) {
    if (!measurement.events.length) { evidence[measurement.key]=[]; continue; }
    try {
      const {stdout}=await run('git',['grep','-l','-F',...measurement.events.flatMap(name=>['-e',`"${name}"`]),sha.trim(),'--','hushh-webapp',
        ':!*test*',':!*spec*',':!hushh-webapp/e2e/*',':!hushh-webapp/docs/*',':!hushh-webapp/contracts/*',':!hushh-webapp/lib/generated/*',
        ':!hushh-webapp/lib/observability/events.ts',':!hushh-webapp/lib/observability/schema.ts'],{cwd:appRepo,timeout:30000,maxBuffer:1000000,windowsHide:true});
      evidence[measurement.key]=stdout.trim().split('\n').filter(Boolean).map(path=>path.replace(/^[0-9a-f]+:/,''));
    } catch(error) { if(error.code!==1) throw new Error('Source inventory could not be read'); evidence[measurement.key]=[]; }
  }
  return {commit:sha.trim(),note:'Candidate runtime references; event/action call sites require code review. A definition is not proof that an installed app emits it.',features:evidence};
}

const evidence = await sourceEvidence();
console.log(JSON.stringify({ mode: 'offline_inventory', featureCount: AGENT_MEASUREMENTS.length,
  displayedFeatureCount: new Set(displayedKeys).size, capabilityCount: capabilities.length,
  sourceEvidence: evidence, sourceStatus: evidence ? 'local_source_inventory' : 'source_repository_not_supplied', note: 'Inventory is not evidence of event capture, source completeness or live dashboard counts.' }, null, 2));
