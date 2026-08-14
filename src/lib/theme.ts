/**
 * Shared surface tokens.
 *
 * Extracted from Dashboard.tsx so panels rendered in their own files inherit
 * the same surfaces instead of re-declaring near-identical class strings that
 * drift apart over time.
 */
export const appleCard =
  'rounded-lg border border-black/[0.06] bg-white/88 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_18px_40px_rgba(0,0,0,0.045)] backdrop-blur-xl';
export const applePanel = 'rounded-lg border border-black/[0.04] bg-[#f6f6f8]';
export const appleLabel = 'text-xs font-bold uppercase text-[#86868b]';
export const dashboardBand = 'border-t border-black/[0.06] pt-8';
