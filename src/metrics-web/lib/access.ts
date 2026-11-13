import 'server-only';
import { cookies } from 'next/headers';
import { reportingSession } from '../../../src/server/reports/session';

export async function currentAccess() {
  // Compatibility name from the existing verified Google OAuth flow.
  return reportingSession((await cookies()).get('hussh_matrix_session')?.value);
}
