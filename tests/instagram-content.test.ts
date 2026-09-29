import { describe, expect, it } from 'vitest';
import { contentLabel, contentTotals, filterContent, type InstagramContent } from '../src/lib/instagram-content';

const media = (id: string, productType: InstagramContent['productType'], views: number | null,
  likes: number | null, publishedAt = '2026-09-28T10:00:00Z'): InstagramContent => ({
  id, mediaType: productType === 'REELS' ? 'VIDEO' : 'IMAGE', productType, publishedAt,
  likeCount: likes, commentsCount: null,
  insights: { views: { value: views, status: views === null ? 'not_yet_available' : 'available' } },
});

describe('Instagram content reporting', () => {
  it('uses Meta product type to identify Reels rather than guessing from VIDEO', () => {
    expect(contentLabel(media('1', 'REELS', 0, 0))).toBe('Reel');
    expect(contentLabel({ mediaType: 'VIDEO', productType: 'FEED' })).toBe('Video post');
    expect(contentLabel({ mediaType: 'VIDEO', productType: 'UNKNOWN' })).toBe('Video · type unknown');
  });
  it('keeps missing views distinct from zero and labels aggregate coverage', () => {
    const totals = contentTotals([media('1', 'REELS', 0, 0), media('2', 'REELS', null, null), media('3', 'FEED', 5, 2)]);
    expect(totals).toMatchObject({ count: 3, reels: 2, feed: 1,
      views: { value: 5, observed: 2 }, likes: { value: 2, observed: 2 } });
  });
  it('filters on the actual published timestamp', () => {
    const items = [media('1', 'REELS', 1, 1), media('2', 'FEED', 2, 2, '2026-08-01T00:00:00Z')];
    expect(filterContent(items, 30, new Date('2026-09-29T00:00:00Z')).map((item) => item.id)).toEqual(['1']);
  });
});
