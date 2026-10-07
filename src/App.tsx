/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { lazy, Suspense } from 'react';
import { MetricsSkeleton } from './components/MetricsLoading';
const dashboardModule = import('./Dashboard');
const Dashboard = lazy(() => dashboardModule);
function DashboardShell() { return <div className="mx-auto min-h-screen max-w-[1320px] bg-[#f5f5f7] p-5 sm:p-8"><p className="mb-6 text-lg font-semibold">Hussh Matrix</p><MetricsSkeleton label="Opening your metrics dashboard" /></div>; }
import { AuthProvider, useAuth } from './components/AuthProvider';
import { LoginPage } from './components/LoginPage';
import { AccessDeniedPage } from './components/AccessDeniedPage';


function AppContent() {
  const { user, authConfig, loading, error, signOut, isAuthenticated, isAuthorized } = useAuth();

  if (loading) return <DashboardShell />;

  // The OAuth callback returns this marker with a 403 response. Show the
  // denial instead of silently presenting the sign-in screen again.
  const deniedEmail = document.getElementById('access-denied-box')?.getAttribute('data-email');
  if (deniedEmail !== null && deniedEmail !== undefined) {
    return <AccessDeniedPage user={deniedEmail ? { email: deniedEmail, domainAuthorized: false } : null} />;
  }

  // 1. If auth is required and user is not signed in -> show Login Gate
  if (authConfig.requireAuth && !isAuthenticated) {
    return (
      <LoginPage
        authConfig={authConfig}
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
  return <Suspense fallback={<DashboardShell />}><Dashboard /></Suspense>;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
