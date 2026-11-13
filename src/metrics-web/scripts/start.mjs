// Standalone artifact is the same entrypoint used by the candidate container.
process.env.PORT ||= '3200';
process.env.HOSTNAME = process.env.METRICS_BIND_HOST || '127.0.0.1';
await import(new URL('../.next/standalone/src/metrics-web/server.js', import.meta.url).href);
