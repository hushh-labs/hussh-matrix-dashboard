/** Only reach has been observed working for this account and login route. */
export const INSTAGRAM_CAPABILITIES = {
  reach: { scope: 'account', status: 'verified', metricType: 'total_value', period: 'day' },
  followers_count: { scope: 'account', status: 'unverified' },
  media_count: { scope: 'account', status: 'unverified' },
  views: { scope: 'account', status: 'unverified' },
  total_interactions: { scope: 'account', status: 'unverified' },
  media: { scope: 'media', status: 'unverified' },
} as const;
