import { currentAccess } from '../../../../lib/access';
import { reportsRuntime } from '../../../../lib/runtime';
import { reportFailure } from '../../../../lib/http';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const access = await currentAccess();
  if (!access) return Response.json({ state: 'unauthorized' }, { status: 401 });
  const runtime = reportsRuntime();
  if (!runtime) return reportFailure(null);
  try { return Response.json(await runtime.status((await context.params).jobId, access)); }
  catch (error) { return reportFailure(error); }
}
