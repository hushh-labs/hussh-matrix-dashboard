import { ShieldCheck, X } from 'lucide-react';

import { formatNumber } from '../lib/analytics-service';

interface FeatureUserBreakdownPanelProps {
  featureLabel: string;
  totalDevices?: number;
  onClose?: () => void;
}

/**
 * Aggregate-only feature detail.
 *
 * Person-level rows do not belong on the public metrics surface. The device
 * total is calculated in BigQuery with COUNT(DISTINCT user_pseudo_id); no
 * names, account identifiers, email addresses, phone numbers, or raw device
 * identifiers are fetched or rendered here.
 */
export function FeatureUserBreakdownPanel({
  featureLabel,
  totalDevices,
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
              {typeof totalDevices === 'number' ? formatNumber(totalDevices) : '—'}
              <span className="ml-1.5 text-sm font-semibold text-[#6e6e73]">unique devices</span>
            </p>
            <p className="mt-1 max-w-2xl text-xs font-medium leading-5 text-[#6e6e73]">
              Distinct GA4 device/browser identifiers in this date window. This is not a unique-person count and is not deduplicated across devices. Individual identity rows are intentionally unavailable on the public dashboard.
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
    </div>
  );
}
