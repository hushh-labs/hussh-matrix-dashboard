import { ShieldCheck, X } from 'lucide-react';

import { exactCount, eventsPerDevice, unclassifiedEvents } from '../lib/feature-measurement';
import type { OneFeatureEventCount } from '../lib/types';

interface FeatureUserBreakdownPanelProps {
  featureLabel: string;
  totalDevices?: number;
  totalEvents?: number | null;
  totalAccounts?: number | null;
  successes?: number | null;
  expectedErrors?: number | null;
  failures?: number | null;
  measurementNote?: string;
  activityDescription?: string;
  eventBreakdown?: OneFeatureEventCount[];
  onClose?: () => void;
}

/**
 * Aggregate-only feature detail.
 *
 * Person-level rows do not belong on the public metrics surface. The device
 * total counts distinct platform + GA4 device/browser IDs; no
 * names, account identifiers, email addresses, phone numbers, or raw device
 * identifiers are fetched or rendered here.
 */
export function FeatureUserBreakdownPanel({
  featureLabel,
  totalDevices,
  totalEvents,
  totalAccounts,
  successes,
  expectedErrors,
  failures,
  measurementNote,
  activityDescription,
  eventBreakdown,
  onClose,
}: FeatureUserBreakdownPanelProps) {
  return (
    <div className="rounded-xl border border-[#465fff]/25 bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#465fff]/10 text-brand-600">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div>
            <h4 className="text-sm font-bold text-ink">{featureLabel}</h4>
            <p className="mt-1 text-2xl font-semibold text-ink">
              {exactCount(totalDevices)}
              <span className="ml-1.5 text-sm font-semibold text-muted">device/browser IDs</span>
            </p>
            <p className="mt-1 max-w-2xl text-xs font-medium leading-5 text-muted">
              {activityDescription} The same ID is counted once in this period; repeated activity increases “Times recorded”.
            </p>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted transition-colors hover:bg-subtle hover:text-ink"
            aria-label={`Close details for ${featureLabel}`}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {totalEvents != null && (
        <div className="mt-4 space-y-3 border-t border-stroke pt-4 text-xs leading-5 text-muted">
          <p><strong className="text-ink">Average per device:</strong> {exactCount(totalEvents)} records ÷ {exactCount(totalDevices)} IDs = {eventsPerDevice(totalEvents, totalDevices ?? null)}. This covers the whole selected period; each device’s activity can differ.</p>
          {totalAccounts != null ? <p><strong className="text-ink">Signed-in accounts:</strong> {exactCount(totalAccounts)} different account IDs. Activity without a signed-in account is excluded from this count.</p> : null}
          <div>
            <p className="font-semibold text-ink">Results at this step</p>
            <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: 'Successful', value: successes },
                { label: 'Canceled / blocked', value: expectedErrors },
                { label: 'Failed', value: failures },
                { label: 'Result not reported', value: unclassifiedEvents(totalEvents, successes ?? null, expectedErrors ?? null, failures ?? null) },
              ].map(item => <div key={item.label} className="rounded-lg bg-canvas p-3"><dt>{item.label}</dt><dd className="mt-1 text-base font-semibold text-ink">{exactCount(item.value)}</dd></div>)}
            </dl>
          </div>
          <p>Success refers to the step named above. A successful view, request or queued job does not prove the whole task finished. Canceled / blocked includes expected no-op results.</p>
          <details className="border-t border-stroke pt-3">
            <summary className="cursor-pointer font-semibold text-ink">Technical details</summary>
            <p className="mt-3">{measurementNote}</p>
            {eventBreakdown?.length ? (
            <div className="overflow-x-auto">
              <div className="metrics-table-scroll" role="region" aria-label="Scrollable metrics table" tabIndex={0}><table className="w-full text-left">
                <caption className="mb-2 text-left font-semibold text-ink">Source events contributing to this row</caption>
                <thead><tr className="text-muted"><th className="py-2 pr-3">Event name</th><th className="px-2 text-right">Records</th><th className="px-2 text-right">Success</th><th className="px-2 text-right">Canceled / no-op</th><th className="px-2 text-right">Failed</th></tr></thead>
                <tbody>{eventBreakdown.map((event) => (
                  <tr key={event.eventName} className="border-t border-stroke">
                    <td className="py-2 pr-3 font-mono">{event.eventName}</td>
                    <td className="px-2 text-right">{exactCount(event.signals)}</td>
                    <td className="px-2 text-right">{exactCount(event.successes)}</td>
                    <td className="px-2 text-right">{exactCount(event.expectedErrors)}</td>
                    <td className="px-2 text-right">{exactCount(event.failures)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>
            ) : <p className="mt-2">Source-event breakdown is unavailable for this response.</p>}
          </details>
        </div>
      )}
      {totalEvents == null ? <p className="mt-3 text-xs leading-5 text-muted">This count is unavailable or not tracked yet. A dash does not mean zero activity.</p> : null}
    </div>
  );
}
