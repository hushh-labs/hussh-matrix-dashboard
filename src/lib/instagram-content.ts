export type InstagramProductType = 'FEED' | 'REELS' | 'STORY' | 'UNKNOWN';

export interface InstagramContent {
  id: string;
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  productType: InstagramProductType;
  publishedAt: string;
  likeCount: number | null;
  commentsCount: number | null;
  insights: Record<string, { value: number | null; status: string; fetchedAt?: string | null }>;
}

export function contentLabel(item: Pick<InstagramContent, 'mediaType' | 'productType'>): string {
  if (item.productType === 'REELS') return 'Reel';
  if (item.productType === 'STORY') return 'Story';
  if (item.productType === 'FEED') {
    if (item.mediaType === 'CAROUSEL_ALBUM') return 'Carousel';
    return item.mediaType === 'VIDEO' ? 'Video post' : 'Photo';
  }
  return item.mediaType === 'VIDEO' ? 'Video · type unknown' : 'Post · type unknown';
}

export function contentTotals(items: InstagramContent[]) {
  const counts = { reels: 0, feed: 0, stories: 0, unknown: 0 };
  const likes = { value: 0, observed: 0 };
  const views = { value: 0, observed: 0 };
  for (const item of items) {
    if (item.productType === 'REELS') counts.reels += 1;
    else if (item.productType === 'FEED') counts.feed += 1;
    else if (item.productType === 'STORY') counts.stories += 1;
    else counts.unknown += 1;
    if (item.likeCount !== null) { likes.value += item.likeCount; likes.observed += 1; }
    const view = item.insights.views;
    if (view?.status === 'available' && view.value !== null) { views.value += view.value; views.observed += 1; }
  }
  return { count: items.length, ...counts, likes, views };
}

export function filterContent(items: InstagramContent[], days: 7 | 30 | 90 | 365, now: Date): InstagramContent[] {
  const since = now.getTime() - days * 86_400_000;
  return items.filter((item) => Date.parse(item.publishedAt) >= since);
}
