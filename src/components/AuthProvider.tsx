/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AuthProvider context component managing Google OAuth state, session lifecycle,
 * domain authorization verification, and sign-out handlers.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  fetchAuthConfig,
  getStoredUserSession,
  storeUserSession,
  clearUserSession,
  verifyCredentialWithBackend,
  DEFAULT_ALLOWED_DOMAINS,
  type AuthUser,
  type AuthConfig,
} from '../lib/auth-service';

interface AuthContextType {
  user: AuthUser | null;
  authConfig: AuthConfig;
  loading: boolean;
  error: string | null;
  signInWithCredential: (credential: string) => Promise<void>;
  signOut: () => void;
  isAuthenticated: boolean;
  isAuthorized: boolean;
}

const defaultAuthConfig: AuthConfig = {
  oauthEnabled: false,
  clientId: (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || '',
  allowedDomains: DEFAULT_ALLOWED_DOMAINS,
  allowedEmails: [],
  requireAuth: false,
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  authConfig: defaultAuthConfig,
  loading: true,
  error: null,
  signInWithCredential: async () => {},
  signOut: () => {},
  isAuthenticated: false,
  isAuthorized: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig>(defaultAuthConfig);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function initAuth() {
      const config = await fetchAuthConfig();
      if (!mounted) return;
      setAuthConfig(config);

      const storedUser = getStoredUserSession();
      if (storedUser) {
        setUser(storedUser);
      }
      setLoading(false);
    }
    initAuth();
    return () => {
      mounted = false;
    };
  }, []);

  const signInWithCredential = async (credential: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await verifyCredentialWithBackend(
        credential,
        authConfig.allowedDomains,
        authConfig.allowedEmails
      );

      if (result.user) {
        setUser(result.user);
        storeUserSession(result.user);
      }

      if (!result.success) {
        setError(result.error || 'Authentication failed or domain not authorized.');
      }
    } catch (err) {
      console.error('Sign-in error:', err);
      setError('An error occurred during authentication. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const signOut = () => {
    setUser(null);
    setError(null);
    clearUserSession();
    if (typeof window !== 'undefined' && (window as any).google?.accounts?.id) {
      try {
        (window as any).google.accounts.id.disableAutoSelect();
      } catch (e) {
        // ignore
      }
    }
  };

  const isAuthenticated = Boolean(user && user.email);
  const isAuthorized = !authConfig.requireAuth || Boolean(user && user.domainAuthorized);

  return (
    <AuthContext.Provider
      value={{
        user,
        authConfig,
        loading,
        error,
        signInWithCredential,
        signOut,
        isAuthenticated,
        isAuthorized,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
