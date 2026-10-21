import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

export function ReportTabs<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void;
}) {
  return <div className="report-tabs" role="group" aria-label={label}>
    {options.map(option => <button key={option.value} type="button" aria-pressed={value === option.value}
      onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}

export function ReportDetails({ title, hint, children }: { title: string; hint?: string; children: ReactNode; key?: string }) {
  const [revealed, setRevealed] = useState(false);
  return <details className="report-details" onToggle={event => { if (event.currentTarget.open) setRevealed(true); }}>
    <summary><span><span>{title}</span>{hint && <small>{hint}</small>}</span><ChevronDown size={17} aria-hidden="true" /></summary>
    <div className="report-details-content">{revealed && children}</div>
  </details>;
}
