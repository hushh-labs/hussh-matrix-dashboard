/** Numbered navigation over confirmed live cursors; never invent a final page. */
export function PlgPagination({ label, page, count, busy, select }: {
  label: string; page: number; count: number; busy: boolean; select: (page: number) => void;
}) {
  const visible = Array.from({ length: count }, (_, index) => index)
    .filter(index => index === 0 || index === count - 1 || Math.abs(index - page) <= 2);
  const button = 'min-w-10 rounded-xl border border-stroke px-3 py-2.5 text-sm font-semibold disabled:opacity-50';
  return <nav aria-label={label} className="flex flex-wrap items-center gap-2">
    <button type="button" className={button} disabled={busy || page === 0}
      aria-label="Previous page" onClick={() => select(page - 1)}>Previous</button>
    {visible.map((index, position) => <span key={index} className="inline-flex items-center gap-2">
      {position > 0 && index - visible[position - 1] > 1 && <span aria-hidden="true" className="px-1 text-muted">…</span>}
      <button type="button" className={`${button} ${index === page ? 'bg-ink text-surface' : 'bg-surface text-ink'}`}
        aria-label={`Page ${index + 1}`} aria-current={index === page ? 'page' : undefined}
        disabled={busy || index === page} onClick={() => select(index)}>{index + 1}</button>
    </span>)}
  </nav>;
}
