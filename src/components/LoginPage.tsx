/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Single-action Google OAuth 2.0 Sign-In Gate for Hussh Matrix Dashboard.
 * Redirects to server OAuth initiation route /api/auth/google.
 */

import { AlertCircle, Loader2 } from 'lucide-react';
import { type AuthConfig } from '../lib/auth-service';

interface LoginPageProps {
  authConfig?: AuthConfig;
  error?: string | null;
  loading?: boolean;
}

export function LoginPage({ error, loading = false }: LoginPageProps) {
  const handleGoogleSignIn = () => {
    const urlParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const returnTo = urlParams.get('returnTo');
    let target = '/api/auth/google';
    if (returnTo) {
      target += `?returnTo=${encodeURIComponent(returnTo)}`;
    }
    window.location.href = target;
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#0b0c10] px-4 py-12 text-[#f5f5f7] selection:bg-[#007aff]/30">
      {/* Background Subtle Gradient Blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-[#007aff]/15 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-[#34c759]/10 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-sm rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-[0_32px_64px_rgba(0,0,0,0.6)] backdrop-blur-2xl text-center flex flex-col items-center">
        {/* Logo / Emoji */}
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
          <span className="text-3xl" role="img" aria-label="Hussh Logo">
            🤫
          </span>
        </div>

        {/* Title & Subtext */}
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Welcome to Hussh Matrix.
        </h1>
        <p className="mt-2 text-xs font-medium text-[#86868b]">
          Use your Hushh work account
        </p>

        {/* Error Notification */}
        {error && (
          <div className="mt-6 flex w-full items-start gap-2.5 rounded-xl border border-[#ff3b30]/30 bg-[#ff3b30]/10 p-3.5 text-left text-xs text-[#ff6961]">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="min-w-0 font-medium leading-5">{error}</div>
          </div>
        )}

        {/* Action Button */}
        <div className="mt-8 w-full flex flex-col items-center">
          {loading ? (
            <div className="flex min-h-[48px] items-center justify-center gap-2 text-xs font-semibold text-[#86868b]">
              <Loader2 className="h-5 w-5 animate-spin text-[#007aff]" />
              <span>Redirecting to Google...</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="group flex w-full items-center justify-center gap-3 rounded-full border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-white/20 active:scale-[0.98]"
            >
              {/* Google G Icon SVG */}
              <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>
          )}
        </div>

        {/* Footer Terms Line */}
        <p className="mt-10 text-[10px] text-[#86868b]">
          By continuing you agree to our <a href="#" className="underline hover:text-white transition">Terms</a> and <a href="#" className="underline hover:text-white transition">Privacy Policy</a>
        </p>
      </div>
    </div>
  );
}

