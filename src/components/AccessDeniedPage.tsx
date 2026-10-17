/** @license SPDX-License-Identifier: Apache-2.0 */
import { ShieldAlert, RefreshCw } from 'lucide-react';
import type { AuthUser, AuthConfig } from '../lib/auth-service';
import { AuthPageLayout } from './AuthPageLayout';

interface AccessDeniedPageProps { user?: AuthUser | null; authConfig?: AuthConfig; onSignOut?: () => void; }

export function AccessDeniedPage({ user }: AccessDeniedPageProps) {
  return <AuthPageLayout>
    <span className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-danger-soft text-danger"><ShieldAlert size={26} /></span>
    <h1>Access restricted</h1>
    <p>This dashboard is available to approved company accounts.</p>
    <div className="auth-note"><span><strong className="block text-ink">Account not approved</strong><span className="break-all">{user?.email || 'Your Google account'}</span><br />Try your Hushh work account or ask your team administrator for access.</span></div>
    <button type="button" className="auth-google-button" onClick={() => { window.location.href = '/api/auth/google?prompt=select_account'; }}><RefreshCw size={18} />Try another account</button>
  </AuthPageLayout>;
}
