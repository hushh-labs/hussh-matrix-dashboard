/** Verified in official v26.0 docs and bounded reads for this company account. */
export const INSTAGRAM_CAPABILITIES = {
  reach: { scope: 'account', status: 'verified', metricType: 'total_value', period: 'day' },
  followers_count: { scope: 'account', status: 'verified', metricType: 'current_snapshot' },
  media_count: { scope: 'account', status: 'verified', metricType: 'current_snapshot' },
  views: { scope: 'account', status: 'verified', metricType: 'total_value', period: 'day' },
  total_interactions: { scope: 'account', status: 'verified', metricType: 'total_value', period: 'day' },
  accounts_engaged: { scope: 'account', status: 'verified', metricType: 'total_value', period: 'day' },
  media: { scope: 'media', status: 'verified' },
  media_product_type: { scope: 'media', status: 'verified', valuesObserved: ['FEED', 'REELS'] },
  media_reach: { scope: 'media', status: 'verified', metricType: 'lifetime_snapshot' },
  media_saved: { scope: 'media', status: 'verified', metricType: 'lifetime_snapshot' },
  media_shares: { scope: 'media', status: 'verified', metricType: 'lifetime_snapshot' },
  media_views: { scope: 'media', status: 'verified', metricType: 'lifetime_snapshot' },
} as const;
