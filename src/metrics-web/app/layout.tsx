import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './styles.css';

export const metadata: Metadata = { title: 'Metrics', description: 'Product adoption, value and reliability.',
  robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><header><a className="brand" href="/">Metrics<span>Hushh</span></a>
    <nav aria-label="Workspace"><a href="/">Reports</a><a href="https://metrics.hussh.ai/plg/uat/workspace">PLG workspace</a></nav>
  </header><main>{children}</main><footer>Counts, coverage and source dates are shown with every report.</footer></body></html>;
}
