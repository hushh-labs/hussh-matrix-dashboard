import { ShieldCheck, X } from 'lucide-react';

import { exactCount, eventsPerDevice, unclassifiedEvents } from '../lib/feature-measurement';
import type { OneFeatureEventCount } from '../lib/types';

interface FeatureUserBreakdownPanelProps {
  featureLabel: string;
  totalDevices?: number;
  totalEvents?: number | null;
  successes?: number | null;
  expectedErrors?: number | null;
  failures?: number | null;
  measurementNote?: string;
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
  successes,
  expectedErrors,
  failures,
  measurementNote,
  eventBreakdown,
  onClose,
}: FeatureUserBreakdownPanelProps) {
  return (
    <div className="rounded-xl border border-[#007aff]/25 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#007aff]/10 text-[#007aff]">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div>
            <h4 className="text-sm font-bold text-[#1d1d1f]">{featureLabel}</h4>
            <p className="mt-1 text-2xl font-semibold text-[#1d1d1f]">
              {exactCount(totalDevices)}
              <span className="ml-1.5 text-sm font-semibold text-[#6e6e73]">distinct device/browser IDs</span>
            </p>
            <p className="mt-1 max-w-2xl text-xs font-medium leading-5 text-[#6e6e73]">
              The same account can use several IDs. Repeated events from the same ID increase the event count without increasing this device count.
            </p>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[#86868b] transition-colors hover:bg-black/5 hover:text-[#1d1d1f]"
            title="Close aggregate detail"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {totalEvents != null && (
        <div className="mt-4 space-y-3 border-t border-black/5 pt-4 text-xs leading-5 text-[#6e6e73]">
          <p><strong className="text-[#1d1d1f]">Events per device:</strong> {exactCount(totalEvents)} events ÷ {exactCount(totalDevices)} IDs = {eventsPerDevice(totalEvents, totalDevices ?? null)} on average in this range. Individual activity can vary.</p>
          <p><strong className="text-[#1d1d1f]">Result reconciliation:</strong> {exactCount(totalEvents)} events = {exactCount(successes)} success + {exactCount(expectedErrors)} canceled / no-op + {exactCount(failures)} failed + {exactCount(unclassifiedEvents(totalEvents, successes ?? null, expectedErrors ?? null, failures ?? null))} without a classified result.</p>
          <p>{measurementNote}</p>
          <p>These are exported records. A success marks the emitting stage, not a unique completed task. Feature and daily device counts can overlap.</p>
          {eventBreakdown?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <caption className="mb-2 text-left font-semibold text-[#1d1d1f]">Source events contributing to this row</caption>
                <thead><tr className="text-[#86868b]"><th className="py-2 pr-3">Event name</th><th className="px-2 text-right">Records</th><th className="px-2 text-right">Success</th><th className="px-2 text-right">Canceled / no-op</th><th className="px-2 text-right">Failed</th></tr></thead>
                <tbody>{eventBreakdown.map((event) => (
                  <tr key={event.eventName} className="border-t border-black/5">
                    <td className="py-2 pr-3 font-mono">{event.eventName}</td>
                    <td className="px-2 text-right">{exactCount(event.signals)}</td>
                    <td className="px-2 text-right">{exactCount(event.successes)}</td>
                    <td className="px-2 text-right">{exactCount(event.expectedErrors)}</td>
                    <td className="px-2 text-right">{exactCount(event.failures)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p>Source-event breakdown is unavailable for this response.</p>}
        </div>
      )}
    </div>
  );
}
