/** Reuse the dashboard's Google work-profile policy in the UAT runtime only. */
export function uatWorkspaceMember(email: string, auth: { requireAuth: boolean; allowedDomains: string[] }, env = process.env) {
  if (!auth.requireAuth || env.GOOGLE_CLOUD_PROJECT !== 'hushh-pda-uat' || env.PLG_UAT_RUNTIME !== 'uat' ||
    env.PLG_DEV_RUNTIME === 'dev' || env.PLG_OWNER_EVIDENCE_ENABLED === 'true') return false;
  // The caller passes only the email from the verified, signed dashboard session.
  const parts = email.trim().toLowerCase().split('@');
  return parts.length === 2 && Boolean(parts[0]) && auth.allowedDomains.some(domain =>
    domain.trim().toLowerCase().replace(/^@/, '') === parts[1]);
}
