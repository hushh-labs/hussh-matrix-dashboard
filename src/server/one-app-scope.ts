export type OneAppEnvironment = 'production' | 'uat';
export type OneAppScope = OneAppEnvironment | 'all';

/** Default comparison remains compatible; an explicit environment never falls back. */
export function oneAppScope(value: unknown): OneAppScope | null {
  return value === undefined ? 'all' : value === 'production' || value === 'uat' || value === 'all' ? value : null;
}

export async function readOneAppEnvironments<T>(scope: OneAppScope, read: (environment: OneAppEnvironment) => Promise<T>) {
  const [production, uat] = await Promise.all([
    scope === 'uat' ? null : read('production'),
    scope === 'production' ? null : read('uat'),
  ]);
  return { production, uat };
}
