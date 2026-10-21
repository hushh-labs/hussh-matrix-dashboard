/** Private PLG contract. Never include these records in aggregate analytics. */
export type PlgAgentId = `agent_${string}`;
export type PlgAudienceSegment = 'all' | 'possible_incomplete' | 'failed' | 'blocked' | 'cancelled' | 'returned' | 'verified' | 'unknown' | 'in_progress';
export interface PlgAudienceFilters {
  agentId: PlgAgentId;
  segment: PlgAudienceSegment;
  query: string;
  graceMinutes: number;
  cursor?: string | null;
}
export interface PlgAudiencePerson {
  accountId: string;
  agentId: PlgAgentId;
  identity: {
    name: string | null;
    email: string | null;
    emailVerified: boolean;
    phoneNumber: string | null;
    phoneVerified: boolean;
    source: 'canonical' | 'firebase';
    updatedAt: string | null;
  };
  activity: {
    coverage: 'observed' | 'not_started' | 'unavailable' | 'reset_during_traversal' | 'limited';
    mode: 'best_effort';
    counts: Record<'started' | 'returned' | 'failed' | 'cancelled' | 'blocked' | 'possibleIncomplete' | 'inProgress' | 'uncorrelated' | 'otherObservations', number>;
    collectionStartedAt: string | null;
    firstAttemptAt: string | null;
    lastObservedAt: string | null;
    lastReturnedAt: string | null;
    lastFailureAt: string | null;
    lastActionId: string | null;
  };
  verified: { supported: boolean; proof?: string | null; count: number; lastAt: string | null; limited: boolean };
}
export interface PlgAudiencePage {
  version: 1;
  environment: 'production';
  catalog: PlgCatalog;
  asOf: string;
  windowStart: string;
  graceMinutes: number;
  source: 'firebase_registered_accounts';
  traversal: 'live';
  scanned: number;
  excluded: number;
  rows: PlgAudiencePerson[];
  nextCursor: string | null;
  campaignEnrollmentChanged: false;
}
export type PlgJourney = 'memory' | 'mail' | PlgAgentId;
export interface PlgOutcomeCoverage {
  status: 'supported' | 'internal' | 'unmeasured';
  proof: string | null;
  label: string;
  reason: string;
}
export interface PlgCatalog {
  revision: string;
  agents: { id: PlgAgentId; label: string; public: boolean; available: boolean; outcome?: PlgOutcomeCoverage }[];
  actions: { id: string; agentId: PlgAgentId; label: string; kind: 'action' | 'agent' | 'tool'; proof: 'client_reported' | 'execution_observed' }[];
}
export interface PlgActivityRollup {
  agentId: PlgAgentId;
  actionId: string;
  source: 'client_reported' | 'execution_observed';
  phase: 'started' | 'returned' | 'failed' | 'cancelled' | 'blocked';
  count: number;
  firstAt: string;
  lastAt: string;
  days: string[];
}
export interface PlgAgentActivity {
  agentId: PlgAgentId;
  reported: number;
  executed: number;
  failed: number;
  lastAt: string;
  days: string[];
}
export interface PlgActivity {
  enabled: boolean;
  mode: 'best_effort';
  limited: boolean;
  startedAt: string | null;
  epoch: string | null;
  rollups: PlgActivityRollup[];
}
export const plgJourneyOptions = (state: Pick<PlgState, 'catalog'>): { id: PlgJourney; label: string }[] => [
  { id: 'memory', label: 'Memory' }, { id: 'mail', label: 'Mail' },
  ...(state.catalog?.agents.filter((a) => a.public && a.available && !['agent_personal_information', 'agent_email'].includes(a.id)).map((a) => ({ id: a.id, label: a.label })) ?? []),
];
export const plgJourneyLabel = (state: Pick<PlgState, 'catalog'>, id: PlgJourney) =>
  plgJourneyOptions(state).find((row) => row.id === id)?.label ?? id;
export type PlgFrequency = 'daily' | 'weekly' | 'updates';
export type PlgStage =
  'unknown' | 'new' | 'setup' | 'blocked' | 'engaged' | 'activated' | 'returning' | 'inactive';
export type PlgStep = 'welcome' | 'demo' | 'help' | 'repeat' | 'return' | 'feedback' | 'newsletter';
export const plgSteps: PlgStep[] = [
  'welcome',
  'demo',
  'help',
  'repeat',
  'return',
  'feedback',
  'newsletter',
];
export const plgStageLabels: Record<PlgStage, string> = {
  unknown: 'Activity unknown',
  new: 'First task needed',
  setup: 'Setup incomplete',
  blocked: 'Needs assistance',
  engaged: 'Agent activity observed',
  activated: 'First value reached',
  returning: 'Returning',
  inactive: 'Ready for a return prompt',
};
export interface PlgTimeline {
  at: string;
  action: string;
  actor: string;
}
export interface PlgContact {
  id: string;
  accountId: string;
  email: string;
  name: string;
  journey: PlgJourney;
  cohort: 'existing' | 'new';
  group: 'treatment' | 'control';
  frequency: PlgFrequency;
  enrolledAt: string;
  consentAt: string | null;
  consentSource: string;
  suppressed: null | 'unsubscribed' | 'bounced' | 'complained' | 'provider_suppressed';
  owner: string;
  blocker: string;
  supportOpen: boolean;
  notes: string;
  telemetryAt: string | null;
  /** A complete observation is separate from a single successful task. */
  observationAt?: string | null;
  activity?: Omit<PlgActivity, 'rollups'> & { agents: PlgAgentActivity[] };
  setupAt: string | null;
  failedAt: string | null;
  firstValueAt: string | null;
  lastValueAt: string | null;
  valueDays: string[];
  pauseUntil: string | null;
  timeline: PlgTimeline[];
  /** Canonical One permission; account identity alone never enables delivery. */
  permission?: {
    revision: number;
    generation: string;
    enabled: boolean;
    eligible: boolean;
    checkedAt: string;
  };
}
export interface PlgTemplate {
  id: string;
  journey: PlgJourney;
  step: PlgStep;
  subject: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  resourceUrl?: string;
  published: boolean;
  version: number;
}
export interface PlgDelivery {
  id: string;
  contactId: string;
  templateId: string;
  step: PlgStep | 'manual';
  key: string;
  status: 'sending' | 'sent' | 'uncertain' | 'delivered' | 'bounced' | 'complained' | 'failed' | 'manual';
  createdAt: string;
  subject: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  resourceUrl?: string;
  providerId: string | null;
  /** Immutable address proof for callbacks after an identity change. */
  recipientHash?: string;
}
export interface PlgState {
  version: 1;
  paused: boolean;
  ready: Record<PlgJourney, boolean>;
  catalog?: PlgCatalog;
  contacts: PlgContact[];
  templates: PlgTemplate[];
  deliveries: PlgDelivery[];
  eventIds: string[];
  /** Erased accounts cannot be re-enrolled by a delayed integration event. */
  erasedAccountHashes?: string[];
  audit: PlgTimeline[];
  /** Hash-only, generation-bound opt-outs survive a backend outage. */
  pendingRevocations?: { accountHash: string; generation: string }[];
  subscriptionSyncAt?: string;
  subscriptionVersions?: Record<string, { revision: number; checkedAt: string }>;
  automation?: {
    enabled: boolean;
    lease?: { id: string; until: string };
    lastCycle?: PlgCycle;
    lastSyncAt?: string;
    lastSuccessAt?: string;
  };
}
export interface PlgCycle {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'completed' | 'blocked' | 'failed';
  reason: string | null;
  accounts: number;
  sent: number | null;
  uncertain: number | null;
}
export interface PlgAutomationStatus {
  enabled: boolean;
  worker: 'never_observed' | 'recent' | 'stale';
  sender: { from: string | null; replyTo: string | null; configured: boolean };
  blockers: string[];
  lastCycle: PlgCycle | null;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  eligible: number;
  blockedReasons: { reason: string; accounts: number }[];
  needsReconciliation: number;
  capacity: { contacts: number; maxContacts: number; bytes: number; maxBytes: number };
}
export interface PlgCandidate {
  contactId: string;
  stage: PlgStage;
  step: PlgStep | null;
  templateId: string | null;
  key: string | null;
  eligible: boolean;
  reason: string;
}
export interface PlgWorkspace {
  role: 'admin' | 'operator';
  configured: boolean;
  deliveryEnabled: boolean;
  automation?: PlgAutomationStatus;
  state: PlgState;
  queue: PlgCandidate[];
  metrics: {
    enrolled: number;
    observed: number;
    activated: number;
    repeat: number;
    activationEligible: number;
    activationConverted: number;
    retentionEligible: number;
    retained: number;
  };
}
