import type { ReactNode } from 'react';
import { MatrixBrand } from './DashboardShell';

export function AuthPageLayout({ children }: { children: ReactNode }) {
  return <div className="auth-layout">
    <section className="auth-form-side">
      <MatrixBrand />
      <div className="auth-form-card">{children}</div>
      <p className="auth-footer">Hushh Matrix · Company analytics</p>
    </section>
    <aside className="auth-art-side" aria-label="About Hushh Matrix">
      <div className="auth-art-content">
        <MatrixBrand />
        <h2>A clearer view of your business.</h2>
        <p>Your product growth, customer usage and performance, together in one place.</p>
        <div className="auth-preview" aria-hidden="true">{[38, 65, 52, 90, 75, 112, 98, 132].map((height, index) => <span key={index} style={{ height }} />)}</div>
      </div>
    </aside>
  </div>;
}
