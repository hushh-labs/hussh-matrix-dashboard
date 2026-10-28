import type { PlgCatalog, PlgJourney } from './plg';

// Domain-specific outcomes are positive evidence, never proof of inactivity.
export const outcomeProofs: Record<string, string> = {
  agent_personal_information: 'memory.confirmed_save.v1', agent_email: 'mail.provider_send.v1',
  agent_calendar: 'calendar.provider_effect.v1', agent_kai: 'kai.confirmed_analysis_save.v1',
  agent_kyc: 'kyc.provider_reply.v1', agent_nav: 'nav.owner_decision.v1',
  agent_location: 'location.domain_effect.v1', agent_wallet: 'wallet.confirmed_card_save.v1',
  agent_career: 'career.confirmed_resume_save.v1', agent_documents: 'documents.approved_share.v1',
  agent_connected_systems: 'crm.provider_readback.v1', agent_one: 'one.distinct_domain_effects.v1',
};

export function outcomeSupported(catalog: PlgCatalog, agentId: string): boolean {
  const agent = catalog.agents.find((a) => a.id === agentId);
  return agent?.outcome ? agent.outcome.status === 'supported' :
    Boolean(agent?.public && ['agent_personal_information', 'agent_email'].includes(agentId));
}

export function outcomeProofMatches(catalog: PlgCatalog, agentId: string, proof: unknown): boolean {
  if (!outcomeSupported(catalog, agentId)) return proof == null;
  return proof === outcomeProofs[agentId] ||
    (proof === undefined && !catalog.agents.find((a) => a.id === agentId)?.outcome &&
      ['agent_personal_information', 'agent_email'].includes(agentId));
}

export function journeyOutcomeCoverage(catalog: PlgCatalog | null | undefined, journey: PlgJourney) {
  const id = journey === 'memory' ? 'agent_personal_information' : journey === 'mail' ? 'agent_email' : journey;
  const agent = catalog?.agents.find((item) => item.id === id);
  // Existing Memory/Mail integrations predate catalog version 2.
  if (!agent && (journey === 'memory' || journey === 'mail')) return { supported: true, label: 'Existing verified outcome adapter' };
  const supported = Boolean(agent?.public && agent.available && outcomeProofs[id] && catalog && outcomeSupported(catalog, id) &&
    outcomeProofMatches(catalog, id, agent.outcome?.proof));
  return { supported, label: supported ? (agent?.outcome?.label ?? 'Existing verified outcome adapter') :
    (agent?.outcome?.status === 'unmeasured' ? agent.outcome.reason : 'Verified task outcome is not available from One') };
}
