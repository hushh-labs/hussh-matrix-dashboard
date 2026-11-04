import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UatActivityContent, type UatActivityEvidence } from '../src/components/PlgUatActivity';

const evidence: UatActivityEvidence = {
  environment: 'uat', checkedAt: '2026-10-31T08:00:00Z', deliveryAuthorized: false,
  catalog: { revision: 'a'.repeat(64), agents: [{ id: 'agent_one', label: 'One', public: true, available: true }],
    actions: [{ id: 'agent:agent_one', agentId: 'agent_one', label: 'One attempt', kind: 'agent', proof: 'execution_observed' }] },
  activity: { enabled: true, mode: 'best_effort', limited: false, startedAt: '2026-10-31T07:00:00Z', epoch: 'b'.repeat(64),
    rollups: [{ agentId: 'agent_one', actionId: 'agent:agent_one', source: 'execution_observed', phase: 'returned', count: 1,
      firstAt: '2026-10-31T07:30:00Z', lastAt: '2026-10-31T07:30:00Z', days: ['2026-10-31'] }] },
};

describe('UAT activity view', () => {
  it('labels observed counts without claiming successful execution or email delivery', () => {
    const html = renderToStaticMarkup(<UatActivityContent evidence={evidence} />);
    expect(html).toContain('UAT');
    expect(html).toContain('One attempt');
    expect(html).toContain('Execution observation');
    expect(html).toContain('returned');
    expect(html).toContain('does not prove a successful outcome');
    expect(html).not.toContain('email sent');
  });

  it('keeps an empty or limited capture window explicitly unknown', () => {
    const html = renderToStaticMarkup(<UatActivityContent evidence={{ ...evidence,
      activity: { ...evidence.activity, limited: true, rollups: [] } }} />);
    expect(html).toContain('this window is incomplete');
    expect(html).toContain('Activity remains unknown');
  });
});
