import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UatActivityContent, type UatActivityEvidence } from '../src/components/PlgUatActivity';
import { PlgAudiencePanel } from '../src/components/PlgAudiencePanel';
import { PlgUatWorkspace } from '../src/components/PlgUatWorkspace';

const evidence: UatActivityEvidence = {
  environment: 'uat', checkedAt: '2026-10-31T08:00:00Z', deliveryAuthorized: false,
  catalog: { revision: 'a'.repeat(64), agents: [{ id: 'agent_one', label: 'One', public: true, available: true }],
    actions: [{ id: 'agent:agent_one', agentId: 'agent_one', label: 'One attempt', kind: 'agent', proof: 'execution_observed' }] },
  activity: { enabled: true, mode: 'best_effort', limited: false, startedAt: '2026-10-31T07:00:00Z', epoch: 'b'.repeat(64),
    rollups: [{ agentId: 'agent_one', actionId: 'agent:agent_one', source: 'execution_observed', phase: 'returned', count: 1,
      firstAt: '2026-10-31T07:30:00Z', lastAt: '2026-10-31T07:30:00Z', days: ['2026-10-31'] }] },
};

describe('UAT activity view', () => {
  it('does not invent a One-only agent list before the UAT catalog connects', () => {
    const html = renderToStaticMarkup(<PlgUatWorkspace />);
    const selector = html.match(/<select\b[^>]*>[\s\S]*?<\/select>/)?.[0];
    expect(selector).toContain('disabled=""');
    expect(selector).toContain('Loading agents');
    expect(selector).not.toContain('value="agent_one"');
    expect(html).not.toContain('No matching accounts');
  });

  it('offers every available public agent from the connected catalog', () => {
    const agents: typeof evidence.catalog.agents = [
      ...evidence.catalog.agents,
      { id: 'agent_email', label: 'Email', public: true, available: true },
      { id: 'agent_calendar', label: 'Calendar', public: true, available: true },
      { id: 'agent_documents', label: 'Documents', public: true, available: true },
      { id: 'agent_files', label: 'Files', public: true, available: false },
      { id: 'agent_internal', label: 'Internal stage', public: false, available: true },
    ];
    const html = renderToStaticMarkup(<PlgAudiencePanel
      state={{ contacts: [], catalog: { ...evidence.catalog, agents } }}
      load={async () => { throw new Error('Server rendering must not request user data'); }}
      openContact={() => undefined} />);
    const selector = html.match(/<select\b[^>]*>[\s\S]*?<\/select>/)?.[0];
    expect(selector).not.toContain('disabled=""');
    for (const agent of agents.filter(a => a.public && a.available))
      expect(selector).toContain(`value="${agent.id}"`);
    expect(selector).not.toContain('value="agent_files"');
    expect(selector).not.toContain('value="agent_internal"');
  });

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
