import { reportingRuntimeConfigFromEnv, createReportingRuntime } from '../src/server/reports/worker-runtime';
import { reportingWorkerServer } from '../src/server/reports/worker-http';

async function main() {
  const config = reportingRuntimeConfigFromEnv();
  if (process.argv[2] === '--check-config') {
    console.log(JSON.stringify({ ok: true, target: 'metrics-reporting-worker', collectionEnabled: config.collectionEnabled }));
    return;
  }
  if (process.argv[2] !== '--serve') throw new Error('Explicit command required');
  const port = Number(process.env.PORT);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Explicit port required');
  const runtime = createReportingRuntime(config), server = reportingWorkerServer(config, runtime);
  process.once('SIGTERM', () => { server.close(() => { void runtime.close(); }); });
  process.once('SIGINT', () => { server.close(() => { void runtime.close(); }); });
  server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ status: 'ready', target: 'metrics-reporting-worker' })));
}
main().catch(() => { console.error(JSON.stringify({ ok: false, target: 'metrics-reporting-worker', state: 'unavailable' })); process.exitCode = 1; });
