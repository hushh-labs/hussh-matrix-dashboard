import { currentAccess } from '../../../../lib/access';
import { reportsRuntime } from '../../../../lib/runtime';
import { privateReportHeaders, reportFailure } from '../../../../lib/http';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ reportId: string }> }) {
  let access: Awaited<ReturnType<typeof currentAccess>>;
  try { access = await currentAccess(); } catch { return reportFailure(null); }
  if (!access) return Response.json({ state: 'unauthorized' }, { status: 401, headers: privateReportHeaders });
  const runtime = reportsRuntime();
  if (!runtime) return reportFailure(null);
  const params = new URL(request.url).searchParams;
  try {
    return Response.json(await runtime.read({ reportId: (await context.params).reportId,
      startDate: params.get('startDate'), endDate: params.get('endDate'), timezone: params.get('timezone') }, access), { headers: privateReportHeaders });
  } catch (error) { return reportFailure(error); }
}
