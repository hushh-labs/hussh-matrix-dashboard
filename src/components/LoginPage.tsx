import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ShieldCheck, Lock, AlertCircle, Loader2, KeyRound } from 'lucide-react';
import { loadGoogleGisScript, type AuthConfig } from '../lib/auth-service';

interface LoginPageProps {
  authConfig: AuthConfig;
  onCredentialResponse: (credential: string) => void;
  error?: string | null;
  loading?: boolean;
}

export function LoginPage({
  authConfig,
  onCredentialResponse,
  error,
  loading = false,
}: LoginPageProps) {
  const [gisLoaded, setGisLoaded] = useState(false);
  const [customClientId, setCustomClientId] = useState('');
  const [clientIdInput, setClientIdInput] = useState('');
  const [showDevOverride, setShowDevOverride] = useState(false);
  
  const activeClientId = customClientId || authConfig.clientId || (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || '';
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
    if (!gisLoaded || !activeClientId || typeof window === 'undefined') return;

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
  }, [gisLoaded, activeClientId, onCredentialResponse]);

  const handleApplyCustomClientId = (e: FormEvent) => {
    e.preventDefault();
    if (clientIdInput.trim()) {
      setCustomClientId(clientIdInput.trim());
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
            Internal analytics & performance center. Google authentication required to view telemetry.
          </p>

          {/* Domain Restriction Badge */}
          <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[#007aff]/20 bg-[#007aff]/10 px-3 py-1 text-xs font-semibold text-[#3395ff]">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Restricted to @hushh.ai & whitelisted team emails</span>
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
              <span>Verifying Google identity token...</span>
            </div>
          ) : activeClientId ? (
            <div className="flex w-full flex-col items-center space-y-4">
              <div ref={buttonContainerRef} className="min-h-[44px]" />
              {!gisLoaded && (
                <p className="text-xs font-medium text-[#86868b]">
                  Loading Google Sign-In...
                </p>
              )}
            </div>
          ) : (
            <div className="w-full space-y-4 rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-5 text-center">
              <div className="flex items-center justify-center text-[#ff9500]">
                <Lock className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-white">Google OAuth Client ID Required</p>
                <p className="mt-1 text-[11px] text-[#86868b]">
                  Set <code className="rounded bg-white/10 px-1 py-0.5 text-white">GOOGLE_OAUTH_CLIENT_ID</code> in environment variables (Cloud Run or <code className="rounded bg-white/10 px-1 py-0.5 text-white">.env.local</code>) to render the Google Sign-In button.
                </p>
              </div>

              {!showDevOverride ? (
                <button
                  type="button"
                  onClick={() => setShowDevOverride(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10"
                >
                  <KeyRound className="h-3.5 w-3.5 text-[#007aff]" />
                  Paste Google Client ID
                </button>
              ) : (
                <form onSubmit={handleApplyCustomClientId} className="space-y-2 pt-2">
                  <input
                    type="text"
                    placeholder="Enter Google Client ID (e.g. xxx.apps.googleusercontent.com)"
                    value={clientIdInput}
                    onChange={(e) => setClientIdInput(e.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-1.5 text-xs font-mono text-white placeholder-white/30 focus:border-[#007aff] focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="w-full rounded-lg bg-[#007aff] py-1.5 text-xs font-bold text-white hover:bg-[#0062cc] transition"
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

