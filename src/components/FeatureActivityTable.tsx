import { Fragment, useState } from 'react';
import { Activity, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { OneFeatureEventCount } from '../lib/types';
import { exactCount, featureActivityDescription, featureMeasurementNote } from '../lib/feature-measurement';
import { cn } from '../lib/utils';
import { FeatureUserBreakdownPanel } from './FeatureUserBreakdownPanel';

export interface FeatureActivityRow {
  key: string;
  label: string;
  icon?: LucideIcon;
  devices: number | null;
  events: number | null;
  accounts?: number | null;
  successes?: number | null;
  expectedErrors?: number | null;
  failures?: number | null;
  measured: boolean;
  badgeLabel: string;
  badgeClass: string;
  explanation: string;
  eventBreakdown?: OneFeatureEventCount[];
}

export function FeatureActivityTable({ rows }: { rows: FeatureActivityRow[] }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  function detailsButton(row: FeatureActivityRow) {
    const expanded = expandedKey === row.key;
    return (
      <button type="button" aria-label={`View details for ${row.label}`} aria-expanded={expanded}
        onClick={() => setExpandedKey(expanded ? null : row.key)}
        className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-brand-600 hover:bg-[#465fff]/10 focus-visible:outline-2 focus-visible:outline-[#465fff]">
        {expanded ? 'Hide details' : 'View details'}
        <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
      </button>
    );
  }

  function detailPanel(row: FeatureActivityRow) {
    return <FeatureUserBreakdownPanel featureLabel={row.label}
      totalDevices={row.measured ? row.devices ?? undefined : undefined}
      totalEvents={row.measured ? row.events : null}
      totalAccounts={row.measured ? row.accounts : undefined}
      successes={row.measured ? row.successes : null}
      expectedErrors={row.measured ? row.expectedErrors : null}
      failures={row.measured ? row.failures : null}
      activityDescription={featureActivityDescription(row.key)}
      measurementNote={featureMeasurementNote(row.key)}
      eventBreakdown={row.measured ? row.eventBreakdown : undefined}
      onClose={() => setExpandedKey(null)} />;
  }

  function featureDescription(row: FeatureActivityRow) {
    const Icon = row.icon ?? Activity;
    return <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-subtle text-brand-600"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-bold text-ink">{row.label}</p>
          <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold', row.badgeClass)}>{row.badgeLabel}</span>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted">{featureActivityDescription(row.key)}</p>
        <details className="mt-1 text-xs leading-5 text-muted"><summary className="cursor-pointer font-medium">Tracking details</summary><p className="mt-1">{row.explanation}</p></details>
      </div>
    </div>;
  }

  return <>
    <div className="space-y-3 md:hidden">
      {rows.map(row => <article key={row.key} className="rounded-2xl border border-stroke bg-surface p-4">
        {featureDescription(row)}
        <dl className="mt-4 grid grid-cols-2 gap-3">
          {[['Devices / browsers', row.devices], ['Times recorded', row.events]].map(([label, value]) => <div key={label as string} className="rounded-xl bg-canvas p-3">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="mt-1 text-xl font-semibold text-ink">{exactCount(row.measured ? value as number | null : null)}</dd>
          </div>)}
        </dl>
        <div className="mt-2">{detailsButton(row)}</div>
        {expandedKey === row.key ? <div className="mt-3">{detailPanel(row)}</div> : null}
      </article>)}
    </div>
    <div className="hidden overflow-hidden rounded-2xl border border-stroke bg-surface md:block">
      <div className="metrics-table-scroll" role="region" aria-label="Scrollable metrics table" tabIndex={0}><table className="w-full text-left">
        <thead><tr className="border-b border-stroke bg-canvas text-xs font-semibold text-muted">
          <th scope="col" className="px-5 py-3">Activity</th>
          <th scope="col" className="px-4 py-3 text-right">Devices / browsers</th>
          <th scope="col" className="px-4 py-3 text-right">Times recorded</th>
          <th scope="col" className="px-4 py-3 text-right">Details</th>
        </tr></thead>
        <tbody>{rows.map(row => <Fragment key={row.key}>
          <tr className="border-b border-stroke">
            <td className="px-5 py-4">{featureDescription(row)}</td>
            <td className="px-4 py-4 text-right text-sm font-semibold text-ink">{exactCount(row.measured ? row.devices : null)}</td>
            <td className="px-4 py-4 text-right text-sm font-semibold text-ink">{exactCount(row.measured ? row.events : null)}</td>
            <td className="px-4 py-4 text-right">{detailsButton(row)}</td>
          </tr>
          {expandedKey === row.key ? <tr><td colSpan={4} className="bg-brand-50 p-4">{detailPanel(row)}</td></tr> : null}
        </Fragment>)}</tbody>
      </table></div>
    </div>
  </>;
}
