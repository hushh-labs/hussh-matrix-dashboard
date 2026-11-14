'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { refreshReport, type RefreshOutcome } from '../../lib/report-refresh';
import type { ReportRequest } from '../../../src/server/reports/contracts';

export function ReportRefresh({ request, enabled }: { request: ReportRequest | null; enabled: boolean }) {
  const router = useRouter(), active = useRef<AbortController | null>(null);
  const [state, setState] = useState<'idle' | 'updating' | RefreshOutcome>('idle');
  useEffect(() => () => { active.current?.abort(); }, []);
  const run = async () => {
    if (!request || !enabled || active.current) return;
    const controller = new AbortController(); active.current = controller; setState('updating');
    try {
      const result = await refreshReport(request, controller.signal);
      if (controller.signal.aborted) return;
      setState(result);
      if (result === 'completed' || result === 'unauthorized') router.refresh();
    } catch { if (!controller.signal.aborted) setState('unavailable'); }
    finally { if (active.current === controller) active.current = null; }
  };
  const message = { idle: '', updating: 'Updating report…', completed: 'Latest published report loaded.',
    pending: 'The update is still running. Check again later.', attention: 'This update needs attention.',
    unavailable: 'Report refresh is currently unavailable.', unauthorized: 'Please sign in again.' }[state];
  return <div className="refresh"><button type="button" disabled={!enabled || !request || state === 'updating'} onClick={run}>
    {state === 'updating' ? 'Updating…' : 'Refresh'}</button><span role="status" aria-live="polite">{message}</span></div>;
}
