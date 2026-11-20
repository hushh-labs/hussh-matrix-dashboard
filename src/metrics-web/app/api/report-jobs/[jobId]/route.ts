import { currentAccess } from '../../../../lib/access';
import { reportsRuntime } from '../../../../lib/runtime';
import { privateReportHeaders, reportFailure } from '../../../../lib/http';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  let access: Awaited<ReturnType<typeof currentAccess>>;
  try { access = await currentAccess(); } catch { return reportFailure(null); }
  if (!access) return Response.json({ state: 'unauthorized' }, { status: 401, headers: privateReportHeaders });
  const runtime = reportsRuntime();
  if (!runtime) return reportFailure(null);
  try { return Response.json(await runtime.status((await context.params).jobId, access), { headers: privateReportHeaders }); }
  catch (error) { return reportFailure(error); }
}
