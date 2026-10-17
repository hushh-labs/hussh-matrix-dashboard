/** Official company mark, reused from one.hussh.ai's /brand/hushh-mark.png. */
export function MatrixBrand({ compact = false }: { compact?: boolean }) {
  return <span className="matrix-brand">
    <img className="matrix-brand-mark" src="/brand/hussh-mark.png" width={34} height={34} alt="hussh" decoding="async" />
    {!compact && <span>hussh<span className="font-normal text-muted"> Matrix</span></span>}
  </span>;
}
