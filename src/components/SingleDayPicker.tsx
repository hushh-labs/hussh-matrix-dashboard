import { ChevronLeft, ChevronRight } from 'lucide-react';
import { shiftDay } from '../lib/daily-activity';

export function SingleDayPicker({ value, min, max, label, onChange }: {
  value: string; min?: string; max: string; label: string; onChange: (day: string) => void;
}) {
  const select = (day: string) => { if (day && (!min || day >= min) && day <= max) onChange(day); };
  return <div className="flex min-w-0 flex-wrap items-center gap-2">
    <span className="text-xs font-semibold text-muted">{label}</span>
    <div className="flex min-w-0 items-center gap-1 rounded-lg border border-stroke bg-surface p-1">
      <button type="button" aria-label={`${label}: previous day`} disabled={!value || Boolean(min && value <= min)}
        onClick={() => select(shiftDay(value, -1))} className="min-h-9 rounded-md px-2 text-muted hover:bg-subtle disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
      <input type="date" aria-label={label} value={value} min={min} max={max} onChange={event => select(event.target.value)}
        className="min-h-9 min-w-0 w-32 bg-transparent text-xs font-semibold text-ink" />
      <button type="button" aria-label={`${label}: next day`} disabled={!value || value >= max}
        onClick={() => select(shiftDay(value, 1))} className="min-h-9 rounded-md px-2 text-muted hover:bg-subtle disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
    </div>
  </div>;
}
