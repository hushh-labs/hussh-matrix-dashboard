/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Google OAuth 2.0 Sign-In Gate for Hussh Matrix Dashboard.
 * Rendered when a user is not authenticated.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ShieldCheck, Lock, AlertCircle, Loader2, KeyRound, Mail, ArrowRight } from 'lucide-react';
import { loadGoogleGisScript, type AuthConfig } from '../lib/auth-service';

interface LoginPageProps {
  authConfig: AuthConfig;
  onCredentialResponse: (credential: string) => void;
  onEmailSubmit: (email: string) => void;
  error?: string | null;
  loading?: boolean;
}

export function LoginPage({
  authConfig,
  onCredentialResponse,
  onEmailSubmit,
  error,
  loading = false,
}: LoginPageProps) {
  const [gisLoaded, setGisLoaded] = useState(false);
  const [customClientId, setCustomClientId] = useState('');
  const [clientIdInput, setClientIdInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [showDevOverride, setShowDevOverride] = useState(false);
  
  const activeClientId = customClientId || authConfig.clientId || (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || '';
  const [authMode, setAuthMode] = useState<'oauth' | 'email'>(activeClientId ? 'oauth' : 'email');

  const buttonContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    loadGoogleGisScript().then((success) => {
      if (mounted) setGisLoaded(success);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!gisLoaded || !activeClientId || authMode !== 'oauth' || typeof window === 'undefined') return;

    const google = (window as any).google;
    if (!google?.accounts?.id) return;

    try {
      google.accounts.id.initialize({
        client_id: activeClientId,
        callback: (response: any) => {
          if (response.credential) {
            onCredentialResponse(response.credential);
          }
        },
        auto_select: false,
      });

      if (buttonContainerRef.current) {
        buttonContainerRef.current.innerHTML = '';
        google.accounts.id.renderButton(buttonContainerRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'pill',
          logo_alignment: 'left',
          width: 280,
        });
      }
    } catch (err) {
      console.error('Failed to initialize Google Sign-In button:', err);
    }
  }, [gisLoaded, activeClientId, authMode, onCredentialResponse]);

  const handleApplyCustomClientId = (e: FormEvent) => {
    e.preventDefault();
    if (clientIdInput.trim()) {
      setCustomClientId(clientIdInput.trim());
      setAuthMode('oauth');
    }
  };

  const handleEmailFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (emailInput.trim()) {
      onEmailSubmit(emailInput.trim());
    }
  };

  const allowedDomainsList = authConfig.allowedDomains.map((d) => `@${d}`).join(', ');

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#0b0c10] px-4 py-12 text-[#f5f5f7] selection:bg-[#007aff]/30">
      {/* Background Subtle Gradient Blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-[#007aff]/15 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-[#34c759]/10 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-8 shadow-[0_32px_64px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
        {/* Header Logo */}
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
            <span className="text-4xl" role="img" aria-label="Hussh Logo">
              🤫
            </span>
          </div>

          <p className="text-xs font-bold uppercase tracking-widest text-[#007aff]">
            Hussh Matrix Dashboard
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">
            Team Access Control
          </h1>
          <p className="mt-2 text-xs font-medium text-[#86868b]">
            Internal analytics & performance center. Authentication required to view telemetry.
          </p>

          {/* Domain Restriction Badge */}
          <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[#007aff]/20 bg-[#007aff]/10 px-3 py-1 text-xs font-semibold text-[#3395ff]">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Restricted to team & company emails</span>
          </div>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-[#ff3b30]/30 bg-[#ff3b30]/10 p-3.5 text-xs text-[#ff6961]">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="min-w-0 font-medium leading-5">{error}</div>
          </div>
        )}

        {/* Sign In Action Area */}
        <div className="mt-8 flex flex-col items-center">
          {loading ? (
            <div className="flex min-h-[50px] items-center gap-2 text-sm font-semibold text-[#86868b]">
              <Loader2 className="h-5 w-5 animate-spin text-[#007aff]" />
              <span>Verifying credentials...</span>
            </div>
          ) : authMode === 'oauth' && activeClientId ? (
            <div className="flex w-full flex-col items-center space-y-4">
              <div ref={buttonContainerRef} className="min-h-[44px]" />
              {!gisLoaded && (
                <p className="text-xs font-medium text-[#86868b]">
                  Loading Google Sign-In...
                </p>
              )}

              <button
                type="button"
                onClick={() => setAuthMode('email')}
                className="mt-2 text-xs font-medium text-[#86868b] hover:text-white transition flex items-center gap-1"
              >
                <Mail className="h-3.5 w-3.5 text-[#007aff]" />
                Or sign in with company email
              </button>
            </div>
          ) : (
            <div className="w-full space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-5 text-left">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#007aff]/30 bg-[#007aff]/15 text-[#007aff]">
                  <Mail className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Company Email Sign-In</h3>
                  <p className="text-[11px] text-[#86868b]">
                    Enter your authorized company or whitelisted email address.
                  </p>
                </div>
              </div>

              {!activeClientId && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5 text-[11px] text-amber-200/90 leading-relaxed">
                  Google OAuth Client ID is unconfigured on server. Enter your company email below to test access.
                </div>
              )}

              <form onSubmit={handleEmailFormSubmit} className="space-y-3 pt-1">
                <div>
                  <label htmlFor="company-email-input" className="block text-[11px] font-semibold text-[#86868b] uppercase tracking-wider mb-1">
                    Work Email Address
                  </label>
                  <input
                    id="company-email-input"
                    type="email"
                    required
                    placeholder="name@hushh.ai or authorized email..."
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-black/50 px-3.5 py-2.5 text-xs text-white placeholder-white/30 focus:border-[#007aff] focus:ring-1 focus:ring-[#007aff] focus:outline-none transition"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#007aff] py-2.5 text-xs font-bold text-white shadow-lg shadow-[#007aff]/25 hover:bg-[#0062cc] active:scale-[0.98] transition"
                >
                  <span>Verify & Access Dashboard</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </form>

              {activeClientId && (
                <div className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={() => setAuthMode('oauth')}
                    className="text-xs font-medium text-[#007aff] hover:underline"
                  >
                    Switch back to Google OAuth Sign-In
                  </button>
                </div>
              )}

              {!showDevOverride ? (
                <div className="pt-2 border-t border-white/10 text-center">
                  <button
                    type="button"
                    onClick={() => setShowDevOverride(true)}
                    className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#86868b] hover:text-white transition"
                  >
                    <KeyRound className="h-3 w-3 text-[#007aff]" />
                    Developer? Set custom Google Client ID
                  </button>
                </div>
              ) : (
                <form onSubmit={handleApplyCustomClientId} className="space-y-2 pt-2 border-t border-white/10">
                  <p className="text-[11px] font-medium text-[#86868b]">Paste Google Client ID:</p>
                  <input
                    type="text"
                    placeholder="e.g. 123456789-abc.apps.googleusercontent.com"
                    value={clientIdInput}
                    onChange={(e) => setClientIdInput(e.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-1.5 text-xs font-mono text-white placeholder-white/30 focus:border-[#007aff] focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="w-full rounded-lg border border-white/20 bg-white/10 py-1.5 text-xs font-bold text-white hover:bg-white/20 transition"
                  >
                    Apply Client ID
                  </button>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Footer Notice */}
        <div className="mt-8 border-t border-white/10 pt-4 text-center text-[11px] font-medium text-[#86868b]">
          Allowed domains: <span className="font-semibold text-white">{allowedDomainsList}</span>
        </div>
      </div>
    </div>
  );
}

