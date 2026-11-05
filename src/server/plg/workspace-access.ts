/** Reuse verified dashboard work-domain membership without granting PLG admin. */
export function workProfileWorkspaceMember(email: string, auth: { requireAuth: boolean; allowedDomains: string[] }, env = process.env) {
  // The existing Production release identifies its runtime by this canonical
  // origin/store tuple; it does not populate GOOGLE_CLOUD_PROJECT. An explicit
  // conflicting project is still rejected rather than inferred away.
  const production = (!env.GOOGLE_CLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT === 'hushh-ai-prod') &&
    env.PLG_FIRESTORE_PROJECT === 'hushh-ai-prod' && env.PLG_FIRESTORE_DATABASE === 'one-plg-production' &&
    env.PLG_PUBLIC_ORIGIN === 'https://metrics.hussh.ai' && env.PLG_UAT_RUNTIME !== 'uat';
  const uat = env.GOOGLE_CLOUD_PROJECT === 'hushh-pda-uat' && env.PLG_UAT_RUNTIME === 'uat' &&
    env.PLG_OWNER_EVIDENCE_ENABLED !== 'true';
  if (!auth.requireAuth || !production && !uat || env.PLG_DEV_RUNTIME === 'dev') return false;
  // The caller passes only the email from the verified, signed dashboard session.
  const parts = email.trim().toLowerCase().split('@');
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email.trim()) && email.trim().length <= 254 &&
    parts.length === 2 && auth.allowedDomains.some(domain =>
    domain.trim().toLowerCase().replace(/^@/, '') === parts[1]);
}
