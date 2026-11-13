import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { OAuth2Client } from 'google-auth-library';
import { ReportError, validateAccess } from './contracts';
import type { ReportingRuntimeConfig, createReportingRuntime } from './worker-runtime';
import { withinDeadline } from './deadline';

export type ReportingWorkerRuntime = ReturnType<typeof createReportingRuntime>;
export type WorkerIdentityVerifier = (token: string, audience: string) => Promise<{ email: string; emailVerified: boolean }>;
export function googleWorkerIdentityVerifier(): WorkerIdentityVerifier {
  const verifier = new OAuth2Client();
  return async (token, audience) => {
    try {
      const ticket = await verifier.verifyIdToken({ idToken: token, audience });
      const p = ticket.getPayload();
      if (!p || !['accounts.google.com', 'https://accounts.google.com'].includes(p.iss) || p.email_verified !== true || !p.email) throw new Error('Invalid identity');
      return { email: p.email, emailVerified: true };
    } catch { throw new ReportError('unauthorized'); }
  };
}
export function reportingWorkerServer(config: ReportingRuntimeConfig, runtime: ReportingWorkerRuntime,
  verify: WorkerIdentityVerifier = googleWorkerIdentityVerifier()) {
  const reply = (res: ServerResponse, status: number, body: unknown, retryAfterMs = 0) => {
    let text = JSON.stringify(body);
    if (Buffer.byteLength(text) > config.maxResponseBytes) { text = '{"state":"unavailable"}'; status = 503; }
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store',
      ...(retryAfterMs > 0 ? { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))) } : {}) });
    res.end(text);
  };
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/healthz') return reply(res, 200, { status: 'ok' });
      const roles: Record<string, string> = {
        '/internal/metrics/read': config.webInvokerEmail, '/internal/metrics/request': config.webInvokerEmail,
        '/internal/metrics/status': config.webInvokerEmail, '/internal/metrics/collect': config.taskInvokerEmail,
        '/internal/metrics/dispatch': config.dispatcherInvokerEmail,
        '/internal/metrics/maintain': config.dispatcherInvokerEmail, '/internal/metrics/schedule': config.dispatcherInvokerEmail,
      };
      if (req.method !== 'POST' || !req.url || !Object.hasOwn(roles, req.url)) return reply(res, 404, { state: 'unavailable' });
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ') || header.length > 16_384) throw new ReportError('unauthorized');
      const identity = await withinDeadline(verify(header.slice(7), config.workerAudience), AbortSignal.timeout(config.rpcTimeoutMs));
      if (!identity.emailVerified || identity.email !== roles[req.url]) throw new ReportError('unauthorized');
      const body = await readBody(req, config.maxRequestBytes);
      if (req.url.endsWith('/maintain')) {
        if (Object.keys(body).length !== 0) throw new ReportError('invalid');
        return reply(res, 200, await runtime.maintain());
      }
      if (req.url.endsWith('/schedule')) {
        if (Object.keys(body).join() !== 'request') throw new ReportError('invalid');
        return reply(res, 202, await runtime.schedule(body.request));
      }
      if (['/internal/metrics/read', '/internal/metrics/request', '/internal/metrics/status'].includes(req.url)) {
        const keys = req.url.endsWith('/status') ? 'access,jobId' : 'access,request';
        if (Object.keys(body).sort().join() !== keys || !body.access || Object.keys(body.access).sort().join() !== 'scopeDigest,subjectHash') throw new ReportError('invalid');
        validateAccess(body.access);
        if (body.access.scopeDigest !== config.scopeDigest) throw new ReportError('unauthorized');
        if (req.url.endsWith('/read')) return reply(res, 200, await runtime.read(body.request, body.access));
        if (req.url.endsWith('/status')) return reply(res, 200, await runtime.status(body.jobId, body.access));
        return reply(res, 202, await runtime.request(body.request, body.access));
      }
      if (Object.keys(body).join() !== 'jobId' || !/^[a-f0-9]{64}$/.test(body.jobId)) throw new ReportError('invalid');
      if (req.url.endsWith('/dispatch')) return reply(res, 200, await runtime.dispatch(body.jobId));
      const result = await runtime.collect(body.jobId);
      const settled = ['completed', 'failed', 'invalidated'].includes(result.state) || result.needsAttention;
      return reply(res, settled ? 200 : 503, result, settled ? 0 : result.retryAfterMs);
    } catch (error) {
      const code = error instanceof ReportError ? error.code : 'unavailable';
      reply(res, code === 'unauthorized' ? 401 : code === 'invalid' ? 400 : ['quota', 'capacity'].includes(code) ? 429 : 503, { state: code });
    }
  });
  server.requestTimeout = config.rpcTimeoutMs;
  server.headersTimeout = Math.min(config.rpcTimeoutMs, 60_000);
  return server;
}
async function readBody(req: IncomingMessage, maxBytes: number): Promise<Record<string, any>> {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json'
    || Number(req.headers['content-length']) > maxBytes) throw new ReportError('invalid');
  let bytes = 0, text = ''; const decoder = new TextDecoder();
  for await (const part of req) {
    bytes += part.byteLength; if (bytes > maxBytes) throw new ReportError('invalid');
    text += decoder.decode(part, { stream: true });
  }
  try {
    const body = JSON.parse(text + decoder.decode());
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
    return body;
  } catch { throw new ReportError('invalid'); }
}
