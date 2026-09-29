/** Owned landing pages only. No redirect endpoint or inferred attribution. */
export const INSTAGRAM_DESTINATIONS = [
  { label: 'Hushh home', url: 'https://hushh.ai/' },
  { label: 'One home', url: 'https://one.hushh.ai/' },
] as const;

const slug = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export function buildInstagramCampaignLink(destination: string, campaign: string, content: string): string | null {
  if (!INSTAGRAM_DESTINATIONS.some((item) => item.url === destination)) return null;
  if (![campaign, content].every((value) => value.length >= 2 && value.length <= 64 && slug.test(value))) return null;
  const url = new URL(destination);
  url.searchParams.set('utm_source', 'instagram');
  url.searchParams.set('utm_medium', 'organic_social');
  url.searchParams.set('utm_campaign', campaign);
  url.searchParams.set('utm_content', content);
  return url.toString();
}
