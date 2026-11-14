import { currentAccess } from '../../../lib/access';
import { reportsRuntime } from '../../../lib/runtime';
import { reportFailure } from '../../../lib/http';
import { ReportError } from '../../../../../src/server/reports/contracts';
export async function POST(request: Request) {
  const access = await currentAccess();
  if (!access) return Response.json({ state: 'unauthorized' }, { status: 401 });
  // Origin is a configured deployment binding, never inferred from Host input.
  if (!process.env.METRICS_WEB_ORIGIN || request.headers.get('origin') !== process.env.METRICS_WEB_ORIGIN
    || request.headers.get('content-type')?.split(';')[0] !== 'application/json') return reportFailure(new ReportError('unauthorized'));
  const runtime = reportsRuntime();
  if (!runtime) return reportFailure(null);
  try {
    if (Number(request.headers.get('content-length')) > 2048) throw new ReportError('invalid');
    const stream = request.body?.getReader();
    if (!stream) throw new ReportError('invalid');
    let text = '', bytes = 0; const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await stream.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 2048) throw new ReportError('invalid');
        text += decoder.decode(chunk.value, { stream: true });
      }
    } finally { await stream.cancel(); }
    const result = await runtime.request(JSON.parse(text + decoder.decode()), access);
    return Response.json(result, { status: result.state === 'completed' ? 200 : 202 });
  } catch (error) { return reportFailure(error instanceof SyntaxError ? new ReportError('invalid') : error); }
}
