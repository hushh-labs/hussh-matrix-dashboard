import { describe, expect, it } from 'vitest';
import { buildInstagramCampaignLink } from '../src/lib/instagram-campaign';

describe('Instagram owned campaign links', () => {
  it('uses the fixed source and medium taxonomy', () => {
    const url = new URL(buildInstagramCampaignLink('https://hushh.ai/', 'launch-us', 'bio-link')!);
    expect(url.origin).toBe('https://hushh.ai');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      utm_source: 'instagram', utm_medium: 'organic_social', utm_campaign: 'launch-us', utm_content: 'bio-link',
    });
  });
  it('rejects off-site destinations and personal-data-like or malformed slugs', () => {
    expect(buildInstagramCampaignLink('https://evil.example/', 'launch-us', 'bio-link')).toBeNull();
    expect(buildInstagramCampaignLink('https://hushh.ai.evil.example/', 'launch-us', 'bio-link')).toBeNull();
    expect(buildInstagramCampaignLink('https://hushh.ai/', 'person@example.com', 'bio-link')).toBeNull();
    expect(buildInstagramCampaignLink('https://hushh.ai/', 'launch-us', 'first name')).toBeNull();
  });
});
