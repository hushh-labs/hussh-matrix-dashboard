import { describe, expect, it } from 'vitest';
import { websiteGa4Request, WEBSITE_HOSTS, WEBSITE_GA4_STREAM } from '../src/server/ga4-website-scope';

describe('website GA4 source boundaries', () => {
  it('restricts core reports to the verified web stream and both requested domains', () => {
    const body = websiteGa4Request({ metrics: [{ name: 'sessions' }] });
    const filters = body.dimensionFilter.andGroup.expressions;
    expect(filters).toContainEqual({ filter: { fieldName: 'streamId', stringFilter: { matchType: 'EXACT', value: WEBSITE_GA4_STREAM, caseSensitive: true } } });
    expect(filters).toContainEqual({ filter: { fieldName: 'hostName', inListFilter: { values: WEBSITE_HOSTS, caseSensitive: false } } });
    expect(filters).toContainEqual({ filter: { fieldName: 'platform', stringFilter: { matchType: 'EXACT', value: 'web', caseSensitive: false } } });
  });
  it('uses supported stream and platform dimensions for realtime and refuses to replace a caller filter', () => {
    expect(websiteGa4Request({}, true).dimensionFilter.andGroup.expressions).toHaveLength(2);
    expect(() => websiteGa4Request({ dimensionFilter: {} })).toThrow();
  });
});
