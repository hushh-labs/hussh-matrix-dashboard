/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Client-side authentication service for the Hussh Matrix Dashboard.
 * Handles Google Identity Services (GIS) OAuth 2.0 sign-in, token decoding,
 * domain/email authorization checks, and session persistence.
 */

export interface AuthUser {
  email: string;
  name: string;
  picture?: string;
  sub: string;
  domainAuthorized: boolean;
  idToken?: string;
}

export interface AuthConfig {
  oauthEnabled: boolean;
  clientId: string;
  allowedDomains: string[];
  allowedEmails: string[];
  requireAuth: boolean;
}

const STORAGE_KEY = 'hussh_matrix_auth_session_v1';

/** Default fallback allowed domains if backend config is unreachable */
export const DEFAULT_ALLOWED_DOMAINS = ['hushh.ai', 'hushhtech.com', 'hushh.labs', 'hush1one.com'];

/** Default fallback whitelisted emails if backend config is unreachable */
export const DEFAULT_ALLOWED_EMAILS = [
  'roopmannvaradharaj@gmail.com',
  'i-akshat@hush1one.com',
  'ankit@hushh.ai',
  'parth@hushh.ai',
  'neelesh1@hushh.ai',
  '23ad052@kpriet.ac.in',
  'sharukhansharukhan926@gmail.com',
  'smirthidharmaiit@gmail.com',
  'divya.rajendranps@gmail.com',
  'jhumma@hushh.ai',
  'manish@hushh.ai',
  'kushal@hushh.ai',
];

/** Load Google Identity Services (GIS) library dynamically */
export function loadGoogleGisScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(false);
    if ((window as any).google?.accounts?.id) return resolve(true);

    const existingScript = document.getElementById('google-gis-script');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(true));
      existingScript.addEventListener('error', () => resolve(false));
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-gis-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

/** Decode JWT payload without external library */
export function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (err) {
    console.error('Failed to decode JWT token:', err);
    return null;
  }
}

/** Check if email matches allowed domain or explicit email whitelist */
export function isEmailAuthorized(
  email: string,
  allowedDomains: string[] = DEFAULT_ALLOWED_DOMAINS,
  allowedEmails: string[] = []
): boolean {
  if (!email || !email.includes('@')) return false;

  const normalizedEmail = email.toLowerCase().trim();
  const domain = normalizedEmail.split('@')[1];

  // 1. Check explicit email whitelist
  if (allowedEmails.map((e) => e.toLowerCase().trim()).includes(normalizedEmail)) {
    return true;
  }

  // 2. Check domain whitelist
  const normalizedDomains = allowedDomains.map((d) => d.toLowerCase().trim().replace(/^@/, ''));
  if (normalizedDomains.includes(domain)) {
    return true;
  }

  return false;
}

/** Get stored user session from localStorage */
export function getStoredUserSession(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUser;
    if (parsed && parsed.email) return parsed;
  } catch (err) {
    console.error('Failed to parse stored user session:', err);
  }
  return null;
}

/** Save user session to localStorage */
export function storeUserSession(user: AuthUser): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } catch (err) {
    console.error('Failed to store user session:', err);
  }
}

/** Remove user session from localStorage */
export function clearUserSession(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.error('Failed to clear user session:', err);
  }
}

/** Get current authorization token for API requests */
export function getAuthToken(): string | null {
  const session = getStoredUserSession();
  return session?.idToken ?? null;
}

/** Fetch auth configuration from backend Express proxy */
export async function fetchAuthConfig(): Promise<AuthConfig> {
  try {
    const res = await fetch('/api/auth/config', {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      return {
        oauthEnabled: Boolean(data.oauthEnabled ?? true),
        clientId: data.clientId || (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || '',
        allowedDomains: data.allowedDomains || DEFAULT_ALLOWED_DOMAINS,
        allowedEmails: data.allowedEmails?.length ? data.allowedEmails : DEFAULT_ALLOWED_EMAILS,
        requireAuth: Boolean(data.requireAuth ?? true),
      };
    }
  } catch (err) {
    console.warn('Failed to fetch auth config from server, using local defaults:', err);
  }

  return {
    oauthEnabled: true,
    clientId: (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || '',
    allowedDomains: DEFAULT_ALLOWED_DOMAINS,
    allowedEmails: DEFAULT_ALLOWED_EMAILS,
    requireAuth: true,
  };
}

/** Verify Google Credential with Backend */
export async function verifyCredentialWithBackend(
  credential: string,
  allowedDomains: string[] = DEFAULT_ALLOWED_DOMAINS,
  allowedEmails: string[] = []
): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
  // Decode client-side first for immediate feedback
  const payload = decodeJwtPayload(credential);
  if (!payload || !payload.email) {
    return { success: false, error: 'Invalid Google identity token format.' };
  }

  const email = payload.email as string;
  const name = (payload.name as string) || email.split('@')[0];
  const picture = payload.picture as string | undefined;
  const sub = payload.sub as string;

  const authorized = isEmailAuthorized(email, allowedDomains, allowedEmails);

  const user: AuthUser = {
    email,
    name,
    picture,
    sub,
    domainAuthorized: authorized,
    idToken: credential,
  };

  // Verify server-side if backend endpoint is available
  try {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.authorized) {
        user.domainAuthorized = true;
        return { success: true, user };
      } else {
        user.domainAuthorized = false;
        return {
          success: false,
          user,
          error: data.message || `Access restricted. ${email} is not an authorized @hushh.ai or @hushhtech.com domain email.`,
        };
      }
    }
  } catch (err) {
    console.warn('Server-side token verification failed, using client validation:', err);
  }

  if (authorized) {
    return { success: true, user };
  } else {
    return {
      success: false,
      user,
      error: `Access restricted. ${email} is not an authorized domain or whitelisted email address.`,
    };
  }
}

/** Verify and authenticate user via company or whitelisted email */
export async function verifyEmailAccess(
  email: string,
  allowedDomains: string[] = DEFAULT_ALLOWED_DOMAINS,
  allowedEmails: string[] = DEFAULT_ALLOWED_EMAILS
): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
  const normEmail = email.trim().toLowerCase();
  if (!normEmail || !normEmail.includes('@')) {
    return { success: false, error: 'Please enter a valid email address.' };
  }

  const authorized = isEmailAuthorized(normEmail, allowedDomains, allowedEmails);
  if (!authorized) {
    return {
      success: false,
      error: `Access restricted. ${email} is not an authorized company domain (@hushh.ai, @hushhtech.com, @hushh.labs, @hush1one.com) or whitelisted email address.`,
    };
  }

  const hexEmail = Array.from(new TextEncoder().encode(normEmail))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const nameParts = normEmail.split('@')[0].split('.');
  const formattedName = nameParts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');

  try {
    const res = await fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normEmail }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.authorized && data.user) {
        const user: AuthUser = {
          ...data.user,
          domainAuthorized: true,
          idToken: `email-auth:${hexEmail}`,
        };
        return { success: true, user };
      }
    }
  } catch (err) {
    console.warn('Backend email verification endpoint unreachable, using client validation:', err);
  }

  const user: AuthUser = {
    email: normEmail,
    name: formattedName,
    sub: `email-${hexEmail.slice(0, 16)}`,
    domainAuthorized: true,
    idToken: `email-auth:${hexEmail}`,
  };

  return { success: true, user };
}
