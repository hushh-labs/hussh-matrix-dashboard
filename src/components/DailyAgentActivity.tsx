import { useState } from 'react';
import type { OneAppSummary } from '../lib/types';
import { dailyAgentRow } from '../lib/daily-activity';
import { founderLatestCompleteDate } from '../lib/founder-briefing';
import { SingleDayPicker } from './SingleDayPicker';

const count = (value: number | null) => value === null ? '—' : value.toLocaleString('en-US');

export function DailyAgentActivity({ one, capabilityKey, onOpenAgent }: {
  one: OneAppSummary | null; capabilityKey?: string; onOpenAgent?: (key: string) => void;
}) {
  const capabilities = (one?.capabilities ?? []).filter(item => !capabilityKey || item.key === capabilityKey);
  const days = [...new Set(capabilities.flatMap(item => (item.daily ?? []).map(point => point.eventDate)))].sort();
  const completedThrough = founderLatestCompleteDate();
  const defaultDay = days.filter(day => day <= completedThrough).at(-1) ?? days.at(-1) ?? '';
  const [chosenDay, setChosenDay] = useState('');
  const day = days.includes(chosenDay) ? chosenDay : defaultDay;
  // Older API revisions do not expose daily-query health; never turn that uncertainty into zero.
  const available = Boolean(one?.available && one.capabilitiesAvailable && one.capabilityDailyAvailable);
  const rows = capabilities.map(item => dailyAgentRow(item, day, available))
    .sort((a, b) => (a.difference ?? Infinity) - (b.difference ?? Infinity) || (b.current ?? -1) - (a.current ?? -1));
  const provisional = day > completedThrough;
  const drops = rows.filter(row => row.difference !== null && row.difference < 0);

  return <section className="dashboard-card p-4 sm:p-6" aria-label="Daily agent traffic">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0"><p className="dashboard-label">Daily activity</p>
        <h2 className="mt-1 text-xl font-semibold text-ink">Which agents gained or lost traffic?</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Devices and browsers using each agent, compared with the day before. One person can use several devices or agents.</p>
      </div>
      {day && <SingleDayPicker label="Inspect agent activity on" value={day} min={days[0]} max={days.at(-1)!} onChange={setChosenDay} />}
    </div>
    {!available || !day ? <p className="mt-4 text-sm text-warning">Daily agent data is unavailable for this period. Try refreshing or choose another date range.</p> : <>
      <p role="status" className={`mt-4 rounded-lg p-3 text-sm ${provisional ? 'bg-warning-soft text-warning' : 'bg-subtle text-ink'}`}>
        {provisional ? 'Recent data may still arrive. Changes are provisional and should not be read as confirmed traffic drops.'
          : drops.length ? `${drops.length} ${drops.length === 1 ? 'agent had' : 'agents had'} fewer active devices than the day before. Largest decreases appear first.`
            : rows.some(row => row.difference !== null) ? 'No day-to-day decrease in the available agent counts.' : 'Choose a range that includes the previous day to see daily changes.'}
      </p>
      <div className="metrics-table-scroll mt-4" role="region" aria-label="Daily agent device comparison" tabIndex={0}>
        <table className="w-full text-left text-sm"><thead><tr className="border-b border-stroke text-xs text-muted">
          <th scope="col" className="py-3 pr-4">Agent</th><th scope="col" className="px-3 text-right">{day}</th>
          <th scope="col" className="px-3 text-right">Previous day</th><th scope="col" className="pl-3 text-right">Change in devices</th>
        </tr></thead><tbody>{rows.map(row => <tr key={row.key} className="border-b border-stroke">
          <th scope="row" className="py-3 pr-4 font-semibold text-ink">{onOpenAgent ? <button type="button" className="min-h-9 text-brand-600 underline-offset-4 hover:underline" onClick={() => onOpenAgent(row.key)} aria-label={`Explore daily ${row.label} activity`}>{row.label}</button> : row.label}</th>
          <td className="px-3 text-right text-ink">{count(row.current)}</td><td className="px-3 text-right text-ink">{count(row.previous)}</td>
          <td className={`pl-3 text-right font-semibold ${provisional ? 'text-muted' : row.difference !== null && row.difference < 0 ? 'text-danger' : 'text-ink'}`}>
            {row.difference === null ? 'Unavailable' : row.difference === 0 ? 'No change' : `${row.difference > 0 ? '+' : ''}${count(row.difference)}${row.percent !== null ? ` (${row.percent > 0 ? '+' : ''}${row.percent.toFixed(1)}%)` : ' · earlier day was 0'}`}
          </td></tr>)}</tbody></table>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted">Dates follow the source reporting calendar. Counts include recorded feature use, including repeat visits across days. They are device counts, so adding rows or days does not give a unique user total. — means unavailable or not tracked; 0 means no matching activity was recorded. Recent exports can be delayed or incomplete.</p>
    </>}
  </section>;
}
