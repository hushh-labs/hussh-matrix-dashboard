/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AuthProvider context component managing server-side session lifecycle.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  fetchCurrentUser,
  logoutUser,
  DEFAULT_ALLOWED_DOMAINS,
  type AuthUser,
  type AuthConfig,
} from '../lib/auth-service';

interface AuthContextType {
  user: AuthUser | null;
  authConfig: AuthConfig;
  loading: boolean;
  error: string | null;
  signOut: () => Promise<void>;
  isAuthenticated: boolean;
  isAuthorized: boolean;
}

const defaultAuthConfig: AuthConfig = {
  oauthEnabled: true,
  allowedDomains: DEFAULT_ALLOWED_DOMAINS,
  allowedEmails: [],
  requireAuth: true,
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  authConfig: defaultAuthConfig,
  loading: true,
  error: null,
  signOut: async () => {},
  isAuthenticated: false,
  isAuthorized: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function initAuth() {
      const currentUser = await fetchCurrentUser();
      if (!mounted) return;
      if (currentUser) {
        setUser(currentUser);
      }
      setLoading(false);
    }
    initAuth();
    return () => {
      mounted = false;
    };
  }, []);

  const signOut = async () => {
    await logoutUser();
    setUser(null);
    window.location.href = '/login';
  };

  const isAuthenticated = Boolean(user && user.email);
  const isAuthorized = Boolean(user && user.domainAuthorized);

  return (
    <AuthContext.Provider
      value={{
        user,
        authConfig: defaultAuthConfig,
        loading,
        error,
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
