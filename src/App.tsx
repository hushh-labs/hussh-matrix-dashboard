/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import Dashboard from './Dashboard';
import { AuthProvider, useAuth } from './components/AuthProvider';
import { LoginPage } from './components/LoginPage';
import { AccessDeniedPage } from './components/AccessDeniedPage';
import { Loader2 } from 'lucide-react';

function AppContent() {
  const { user, authConfig, loading, error, signInWithCredential, signOut, isAuthenticated, isAuthorized } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-[#0b0c10] text-white">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 backdrop-blur-xl">
          <Loader2 className="h-6 w-6 animate-spin text-[#007aff]" />
          <span className="text-sm font-semibold">Authenticating Hussh Matrix...</span>
        </div>
      </div>
    );
  }

  // 1. If auth is required and user is not signed in -> show Login Gate
  if (authConfig.requireAuth && !isAuthenticated) {
    return (
      <LoginPage
        authConfig={authConfig}
        onCredentialResponse={signInWithCredential}
        error={error}
        loading={loading}
      />
    );
  }

  // 2. If signed in, but email domain is NOT allowed -> show Access Denied screen
  if (authConfig.requireAuth && user && !user.domainAuthorized) {
    return (
      <AccessDeniedPage
        user={user}
        authConfig={authConfig}
        onSignOut={signOut}
      />
    );
  }

  // 3. Authenticated & Authorized -> render full Dashboard
  return <Dashboard />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
