/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Client-side authentication models and session helpers for Hussh Matrix Dashboard.
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

/** Default explicit email whitelist */
export const DEFAULT_ALLOWED_EMAILS = [
  'i-akshat@hush1one.com',
  '23ad052@kpriet.ac.in',
  'roopmannvaradharaj@gmail.com',
  'sharukhansharukhan926@gmail.com',
  'smirthidharmaiit@gmail.com',
  'divya.rajendranps@gmail.com',
];

/** Check current user session from server endpoint /api/auth/me */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    const res = await fetch('/api/auth/me', {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.email) {
        return {
          email: data.email,
          name: data.name || data.email.split('@')[0],
          picture: data.picture,
          sub: data.sub,
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
