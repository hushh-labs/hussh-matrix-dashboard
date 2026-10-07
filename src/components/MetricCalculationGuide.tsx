import type { OneAppSummary } from '../lib/types';

export function MetricCalculationGuide({ summary }: { summary: OneAppSummary | null }) {
  return (
    <section aria-label="KPI guide" className="rounded-2xl border border-black/5 bg-[#fbfbfd] p-4 text-xs text-[#6e6e73]">
      <h3 className="text-sm font-bold text-[#1d1d1f]">How to read these KPIs</h3>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        {[
          ['Devices / browsers', 'How many different app or browser IDs recorded this activity. One person can use several IDs.'],
          ['Times recorded', 'How often the activity was logged during the selected period. Repeated activity counts again.'],
        ].map(([label, definition]) => (
          <div key={label}>
            <dt className="font-semibold text-[#1d1d1f]">{label}</dt>
            <dd className="mt-1 leading-5">{definition}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 rounded-xl bg-white p-3 leading-5 text-[#1d1d1f]"><strong>Example:</strong> One device opening a shared location five times = <strong>1 device, 5 views.</strong></p>
      <p className="mt-3 leading-5">One task can appear in several rows. Each row names the step being counted. Open <strong>View details</strong> for its results and calculation.</p>
      <details className="mt-3 border-t border-black/5 pt-3">
        <summary className="cursor-pointer font-semibold text-[#1d1d1f]">More about the counts</summary>
        <ul className="mt-3 list-disc space-y-2 pl-4 leading-5">
          <li>Signed-in accounts count different account IDs. Activity without a signed-in account is excluded from that count.</li>
          <li>Average per device = times recorded ÷ device/browser IDs, for the whole period.</li>
          <li>Success applies to the step in that row. A successful view or request does not prove the whole task finished.</li>
          <li>0 means no matching activity was found. — means the count is unavailable or not tracked yet.</li>
          <li>The same device or account can appear in several rows and on several days. Do not add those counts to get a unique total.</li>
          <li>App activity → analytics record → matching feature → dashboard count. Repeated records are retained.</li>
          <li>Recent data can arrive late or change. Finalized daily data replaces overlapping streaming data.</li>
          <li>Production and UAT use separate analytics sources. Native app build and backend environment are not verified by that selection.</li>
        </ul>
        {summary?.range ? <p className="mt-3 leading-5">Selected period: {summary.range.startDate} to {summary.range.endDate}, including both dates.</p> : null}
      </details>
    </section>
  );
}
