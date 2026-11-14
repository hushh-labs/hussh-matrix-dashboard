export const WEBSITE_GA4_PROPERTY = '458078330';
export const WEBSITE_GA4_MEASUREMENT = 'G-PPEF1CSJ5H';
export const WEBSITE_GA4_STREAM = '14681621075';
export const WEBSITE_HOSTS = ['hushh.ai', 'www.hushh.ai', 'hussh.si', 'www.hussh.si'];

/** Bind every report to the verified website stream. Realtime API has no hostName dimension. */
export function websiteGa4Request(body: Record<string, unknown>, realtime = false) {
  if (body.dimensionFilter !== undefined) throw new Error('Website GA4 scope cannot replace an existing filter.');
  const expressions: Record<string, unknown>[] = [
    { filter: { fieldName: 'streamId', stringFilter: { matchType: 'EXACT', value: WEBSITE_GA4_STREAM, caseSensitive: true } } },
    { filter: { fieldName: 'platform', stringFilter: { matchType: 'EXACT', value: 'web', caseSensitive: false } } },
  ];
  if (!realtime) expressions.push({ filter: { fieldName: 'hostName', inListFilter: { values: WEBSITE_HOSTS, caseSensitive: false } } });
  return { ...body, dimensionFilter: { andGroup: { expressions } } };
}
