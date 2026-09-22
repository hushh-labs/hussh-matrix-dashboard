/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Access Denied screen for users whose Google email does not match
 * the authorized domains (@hushh.ai, @hushhtech.com) or explicit whitelist.
 */

import { ShieldAlert, LogOut, Mail, ArrowRight } from 'lucide-react';
import type { AuthUser, AuthConfig } from '../lib/auth-service';

interface AccessDeniedPageProps {
  user: AuthUser;
  authConfig: AuthConfig;
  onSignOut: () => void;
}

export function AccessDeniedPage({ user, authConfig, onSignOut }: AccessDeniedPageProps) {
  const allowedList = authConfig.allowedDomains.map((d) => `@${d}`).join(', ');

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#0b0c10] px-4 py-12 text-[#f5f5f7] selection:bg-[#ff3b30]/30">
      {/* Background Glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-[#ff3b30]/10 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-[#ff9500]/10 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-[#ff3b30]/20 bg-white/[0.04] p-8 shadow-[0_32px_64px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
        {/* Shield Icon */}
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#ff3b30]/30 bg-[#ff3b30]/10 text-[#ff453a] shadow-inner">
            <ShieldAlert className="h-8 w-8" />
          </div>

          <p className="text-xs font-bold uppercase tracking-widest text-[#ff453a]">
            Access Restricted
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">
            Unauthorized Account
          </h1>
          <p className="mt-2 text-xs font-medium text-[#86868b] leading-relaxed">
            The Hussh Matrix Dashboard contains internal telemetry and is restricted to authorized company email domains.
          </p>

          {/* User Email Pill */}
          <div className="mt-5 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-semibold text-white">
            {user.picture ? (
              <img src={user.picture} alt="" className="h-5 w-5 rounded-full" />
            ) : (
              <Mail className="h-4 w-4 text-[#86868b]" />
            )}
            <span>{user.email}</span>
          </div>

          {/* Explanation Box */}
          <div className="mt-6 w-full rounded-xl border border-white/10 bg-white/[0.02] p-4 text-left text-xs space-y-2">
            <div className="font-semibold text-white">Why am I seeing this?</div>
            <p className="text-[#86868b] leading-5">
              Your account <strong className="text-white">{user.email}</strong> is not associated with an authorized email domain ({allowedList}) and is not on the whitelisted access list.
            </p>
          </div>

          {/* Action Button */}
          <div className="mt-8 w-full">
            <button
              type="button"
              onClick={onSignOut}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff3b30] py-3 text-xs font-bold text-white shadow-lg transition hover:bg-[#d73328] active:scale-[0.99]"
            >
              <LogOut className="h-4 w-4" />
              Sign Out & Try Another Account
              <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
