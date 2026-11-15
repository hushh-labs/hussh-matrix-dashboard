import { describe, expect, it } from 'vitest';
import { buildHushhAiSearchMetrics, buildHushhTechOpsMetrics } from '../src/lib/analytics-service';
import type { HushhAiSummary, HushhTechMetricsSummary } from '../src/lib/types';

describe('Search availability in dashboard metrics', () => {
  it.each([false, true])('distinguishes unavailable from measured zero (available=%s)', available => {
    const overview = { clicks: 0, impressions: 0, ctr: null, averagePosition: null };
    const search = { available, ...overview, overview, queries: [], pages: [], countries: [], devices: [] };
    const ai = buildHushhAiSearchMetrics({ searchConsole: search } as unknown as HushhAiSummary);
    const tech = buildHushhTechOpsMetrics({ searchPerformance: search } as unknown as HushhTechMetricsSummary);
    for (const metrics of [ai, tech]) {
      for (const label of ['Search Clicks', 'Search Impressions']) {
        const item = metrics.find(metric => metric.label === label)!;
        expect(item.displayValue).toBe(available ? undefined : 'Waiting');
        if (available) expect(item.value).toBe(0);
      }
    }
  });
});
