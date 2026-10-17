/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Client-side authentication models and session helpers for hussh Matrix Dashboard.
 */

export interface AuthUser {
  email: string;
  name?: string;
  picture?: string;
  sub?: string;
  domainAuthorized: boolean;
}

export interface AuthConfig {
  oauthEnabled: boolean;
  allowedDomains: string[];
  allowedEmails: string[];
  requireAuth: boolean;
}

/** Default fallback allowed domains */
export const DEFAULT_ALLOWED_DOMAINS = ['hushh.ai', 'hushhtech.com', 'hushh.labs', 'hush1one.com'];

/** Check current user session from server endpoint /api/auth/me */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    const res = await fetch('/api/auth/me', {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      const user = data?.authenticated === true ? data.user : null;
      if (user && typeof user.email === 'string' && user.email) {
        return {
          email: user.email,
          name: user.name || user.email.split('@')[0],
          picture: user.picture,
          domainAuthorized: true,
        };
      }
    }
  } catch (err) {
    console.warn('Failed to fetch current user session from server:', err);
  }
  return null;
}

/** Perform POST logout */
export async function logoutUser(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    console.warn('Logout request failed:', err);
  }
}
