/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Access Denied screen for users whose Google email does not match
 * authorized domains (@hushh.ai, @hushhtech.com, etc.) or explicit whitelist.
 */

import { ShieldAlert, RefreshCw } from 'lucide-react';
import type { AuthUser, AuthConfig } from '../lib/auth-service';

interface AccessDeniedPageProps {
  user?: AuthUser | null;
  authConfig?: AuthConfig;
  onSignOut?: () => void;
}

export function AccessDeniedPage({ user }: AccessDeniedPageProps) {
  const handleTryAnotherAccount = () => {
    window.location.href = '/api/auth/google?prompt=select_account';
  };

  const userEmail = user?.email || 'Your account';

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#0b0c10] px-4 py-12 text-[#f5f5f7] selection:bg-[#ff3b30]/30">
      {/* Background Glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-[#ff3b30]/10 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-[#ff9500]/10 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-[#ff3b30]/20 bg-white/[0.04] p-8 shadow-[0_32px_64px_rgba(0,0,0,0.5)] backdrop-blur-2xl text-center">
        {/* Shield Icon */}
        <div className="flex flex-col items-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#ff3b30]/30 bg-[#ff3b30]/10 text-[#ff453a] shadow-inner">
            <ShieldAlert className="h-8 w-8" />
          </div>

          <p className="text-xs font-bold uppercase tracking-widest text-[#ff453a]">
            Access Restricted
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">
            Access Denied
          </h1>
          <p className="mt-2 text-xs font-medium text-[#86868b] leading-relaxed">
            Please use your Hushh work email account to access this dashboard.
          </p>

          {/* Explanation Box */}
          <div className="mt-6 w-full rounded-xl border border-white/10 bg-white/[0.02] p-4 text-left text-xs space-y-2">
            <div className="font-semibold text-white">Unauthorized Google Account</div>
            <p className="text-[#86868b] leading-5">
              Account <strong className="text-white">{userEmail}</strong> is not authorized. Access is restricted to company domain members and explicit whitelisted team accounts.
            </p>
          </div>

          {/* Action Button */}
          <div className="mt-8 w-full">
            <button
              type="button"
              onClick={handleTryAnotherAccount}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 border border-white/20 py-3 text-xs font-bold text-white shadow-lg transition hover:bg-white/20 active:scale-[0.99]"
            >
              <RefreshCw className="h-4 w-4" />
              Try Another Account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
