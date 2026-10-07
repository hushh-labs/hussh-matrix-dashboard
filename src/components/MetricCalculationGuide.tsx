import type { OneAppSummary } from '../lib/types';
import { exactCount } from '../lib/feature-measurement';

export function MetricCalculationGuide({ summary }: { summary: OneAppSummary | null }) {
  return (
    <details className="rounded-2xl border border-black/5 bg-[#fbfbfd] p-4 text-xs text-[#6e6e73]">
      <summary className="cursor-pointer font-bold text-[#1d1d1f]">How these metrics are calculated</summary>
      <p className="mt-3 leading-5">
        App action → analytics event → GA4 export → matching feature → aggregate count.
        {summary?.range ? ` Selected export dates: ${summary.range.startDate} through ${summary.range.endDate}, inclusive.` : ''}
        {' '}Current-day streaming data is provisional. Finalized daily tables replace overlapping streaming tables.
      </p>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        {[
          ['Recorded events', 'Count of matching exported records. Repeats and different stages count again. This is not a count of people, sessions or completed tasks.'],
          ['Devices / browsers', 'Distinct platform + GA4 device/browser IDs among matching records. The same account on two devices can contribute two IDs; reinstalling or resetting analytics can create another ID.'],
          ['Identified accounts', 'Distinct signed-in One account IDs among matching records. Anonymous records are excluded. An account is not necessarily one unique human.'],
          ['Events / device', 'Recorded events ÷ distinct device/browser IDs. This is an average over the whole selected range, not per day or the activity of each individual device.'],
          ['Result columns', 'Success: result=success. Canceled / no-op: result=expected_error (expected blocks can also be included). Failed: result=error. No result: missing or other result values; these are not assumed successful.'],
          ['Status and totals', 'Zero means the source was read and no matching records were found. Unavailable means the query failed. Feature devices/accounts and daily device counts overlap, so do not add rows to get unique totals.'],
        ].map(([label, definition]) => (
          <div key={label}>
            <dt className="font-semibold text-[#1d1d1f]">{label}</dt>
            <dd className="mt-1 leading-5">{definition}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 leading-5">
        Each feature can measure a view, request, accepted job or completion. A recorded success applies to that stage;
        it is not an end-to-end completion rate. Repeated client emissions are retained because the export has no task/session ID that proves they are duplicates.
      </p>
      <p className="mt-3 leading-5">
        Production and UAT use separate GA4 properties and exact web hosts; native events use the One app ID.
        A GA4 property does not verify a native build’s release channel or backend environment.
        {summary?.expectedLagSeconds != null ? ` Expected streaming delay: about ${exactCount(summary.expectedLagSeconds)} seconds; export delays can be longer.` : ''}
        {summary?.generatedAt ? ` Aggregate generated: ${summary.generatedAt}.` : ''}
      </p>
    </details>
  );
}
