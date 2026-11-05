/** Explicit read-only UAT view hosted by the existing Production dashboard. */
export function hostedUatView(env = process.env) {
  return env.PLG_UAT_VIEW_ENABLED === 'true' &&
    (!env.GOOGLE_CLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT === 'hushh-ai-prod') &&
    env.PLG_PUBLIC_ORIGIN === 'https://metrics.hussh.ai' &&
    env.PLG_FIRESTORE_PROJECT === 'hushh-ai-prod' && env.PLG_FIRESTORE_DATABASE === 'one-plg-production' &&
    env.PLG_UAT_RUNTIME !== 'uat' && env.PLG_DEV_RUNTIME !== 'dev';
}
