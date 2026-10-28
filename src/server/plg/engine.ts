import { createHash, randomUUID } from 'node:crypto';
import { journeyOutcomeCoverage, outcomeProofMatches } from '../../lib/plg-outcomes';
import {
  plgSteps,
  plgJourneyOptions,
  type PlgCatalog,
  type PlgCandidate,
  type PlgContact,
  type PlgDelivery,
  type PlgJourney,
  type PlgStage,
  type PlgState,
  type PlgStep,
  type PlgTemplate,
} from '../../lib/plg';

export const DAY = 86_400_000;
export class PlgError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const iso = (now: number) => new Date(now).toISOString();
const age = (at: string | null | undefined, now: number) => (at ? now - Date.parse(at) : Infinity);
export const accountHash = (accountId: string) =>
  createHash('sha256').update(accountId).digest('hex');
const eventKey = (eventId: string) => `eventhash:${accountHash(eventId)}`;
const seenEvent = (state: PlgState, eventId: string) =>
  state.eventIds.includes(eventKey(eventId)) || state.eventIds.includes(`event:${eventId}`);
export function eraseAccount(state: PlgState, accountId: string, now: number) {
  const ids = new Set(state.contacts.filter((c) => c.accountId === accountId).map((c) => c.id));
  state.contacts = state.contacts.filter((c) => !ids.has(c.id));
  state.deliveries = state.deliveries.filter((d) => !ids.has(d.contactId));
  state.eventIds = state.eventIds
    .filter((id) => !id.startsWith(`action:${accountId}:`))
    // Old producers could include personal identifiers in arbitrary event IDs.
    // Hash legacy IDs while retaining deduplication for delayed replays.
    .map((id) => (id.startsWith('event:') ? eventKey(id.slice(6)) : id));
  state.erasedAccountHashes = [
    ...new Set([...(state.erasedAccountHashes ?? []), accountHash(accountId)]),
  ];
  audit(state, 'One product', 'Erased a deleted account and blocked delayed re-enrollment.', now);
}
export function eraseAccountHash(state: PlgState, hash: string, now: number) {
  for (const contact of [...state.contacts]) {
    if (accountHash(contact.accountId) === hash) eraseAccount(state, contact.accountId, now);
  }
  state.erasedAccountHashes = [...new Set([...(state.erasedAccountHashes ?? []), hash])];
  state.pendingRevocations = state.pendingRevocations?.filter((item) => item.accountHash !== `sha256:${hash}`);
}
export function text(value: unknown, max: number, required = false): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw new PlgError(400, 'Invalid text field.');
  const result = value.trim();
  if (required && !result) throw new PlgError(400, 'A required field is missing.');
  return result;
}
export function choose<T extends string>(value: unknown, choices: readonly T[]): T {
  if (!choices.includes(value as T)) throw new PlgError(400, 'Choose a valid field value.');
  return value as T;
}
export function taskUrl(value: unknown): string {
  let url: URL;
  try {
    url = new URL(text(value, 1000, true));
  } catch {
    throw new PlgError(400, 'Use a task link on one.hussh.ai or one.hushh.ai.');
  }
  if (
    url.protocol !== 'https:' ||
    !['one.hussh.ai', 'one.hushh.ai'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new PlgError(400, 'Use a task link on one.hussh.ai or one.hushh.ai.');
  return url.toString();
}
export function resourceUrl(value: unknown): string {
  if (value === undefined || value === '') return '';
  let url: URL;
  try {
    url = new URL(text(value, 1000, true));
  } catch {
    throw new PlgError(400, 'Use a valid HTTPS demo or guide link.');
  }
  const allowed = [
    'one.hussh.ai',
    'one.hushh.ai',
    'hushh.ai',
    'www.hushh.ai',
    'hussh.si',
    'www.hussh.si',
    'youtube.com',
    'www.youtube.com',
    'youtu.be',
    'instagram.com',
    'www.instagram.com',
    'x.com',
  ];
  if (
    url.protocol !== 'https:' ||
    !allowed.includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new PlgError(400, 'Use an approved One, blog, YouTube, Instagram or X content link.');
  return url.toString();
}
export function initialPlgState(): PlgState {
  const copy: Record<PlgStep, [string, string]> = {
    welcome: [
      'Try one useful task with One',
      'Choose a task that would help you today. This short guide walks you through the first result. Reply if you would like help.',
    ],
    demo: [
      'A short walkthrough to get started',
      'Here is a practical demonstration of your chosen workflow. Open the task and try it with information you choose to use.',
    ],
    help: [
      'Would a walkthrough help?',
      'If setup is getting in the way, reply with the step where you are stuck. Our team can help you get started.',
    ],
    repeat: [
      'Try your next useful task',
      'When you next need this workflow, One is ready. Try another task and tell us whether the result was useful.',
    ],
    return: [
      'A useful reason to return to One',
      'Need this workflow again? Open One to continue. Reply if something has stopped working or you need a hand.',
    ],
    feedback: [
      'What would make One more useful?',
      'What were you hoping One would help you do? Reply with your feedback so we can improve the experience.',
    ],
    newsletter: [
      'One useful thing with One',
      'Add a practical tip, a verified demonstration and one relevant action before publishing this edition.',
    ],
  };
  return {
    version: 1,
    paused: true,
    ready: { memory: false, mail: false },
    contacts: [],
    deliveries: [],
    eventIds: [],
    audit: [],
    templates: (['memory', 'mail'] as const).flatMap((journey) =>
      plgSteps.map((step) => ({
        id: `${journey}-${step}`,
        journey,
        step,
        subject: copy[step][0],
        body: copy[step][1],
        ctaLabel: 'Open One',
        ctaUrl: 'https://one.hussh.ai/',
        published: false,
        version: 1,
      })),
    ),
  };
}
export function audit(state: PlgState, actor: string, action: string, now: number) {
  state.audit.unshift({ actor, action, at: iso(now) });
  state.audit = state.audit.slice(0, 100);
}
export function registerPlgCatalog(state: PlgState, catalog: PlgCatalog) {
  state.catalog = catalog;
  const defaults = initialPlgState().templates.filter((t) => t.journey === 'memory');
  for (const journey of plgJourneyOptions(state)) {
    state.ready[journey.id] ??= false;
    if (state.templates.some((t) => t.journey === journey.id)) continue;
    state.templates.push(...defaults.map((t) => ({ ...t, id: `${journey.id}-${t.step}`, journey: journey.id })));
  }
}
export function timeline(contact: PlgContact, actor: string, action: string, now: number) {
  contact.timeline.unshift({ actor, action, at: iso(now) });
  contact.timeline = contact.timeline.slice(0, 30);
}
export function enroll(
  state: PlgState,
  input: Record<string, unknown>,
  actor: string,
  now: number,
): PlgContact {
  if (state.contacts.length >= 100)
    throw new PlgError(409, 'This pilot supports 100 enrolled accounts.');
  const accountId = text(input.accountId, 128, true);
  if (state.erasedAccountHashes?.includes(accountHash(accountId)))
    throw new PlgError(409, 'This account has been erased from the pilot.');
  const email = text(input.email, 254, true).toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || /[\r\n]/.test(email))
    throw new PlgError(400, 'Enter a valid email address.');
  if (input.environment !== 'production' || input.internal !== false)
    throw new PlgError(400, 'Only verified production customer accounts can enroll.');
  if (state.contacts.some((c) => c.accountId === accountId || c.email === email))
    throw new PlgError(409, 'This account or email is already enrolled.');
  const consentSource = text(input.consentSource ?? '', 200);
  if (input.consent === true && !consentSource)
    throw new PlgError(400, 'Record the source of messaging permission.');
  const contact: PlgContact = {
    id: randomUUID(),
    accountId,
    email,
    name: text(input.name ?? '', 100),
    journey: choose(input.journey, plgJourneyOptions(state).map((j) => j.id)),
    cohort: choose(input.cohort, ['new', 'existing']),
    group:
      createHash('sha256').update(`one-plg-v1:${accountId}`).digest().readUInt32BE(0) % 100 < 20
        ? 'control'
        : 'treatment',
    frequency: choose(input.frequency ?? 'weekly', ['daily', 'weekly', 'updates']),
    enrolledAt: iso(now),
    consentAt: input.consent === true ? iso(now) : null,
    consentSource,
    suppressed: null,
    owner: '',
    blocker: '',
    notes: '',
    supportOpen: false,
    telemetryAt: null,
    setupAt: null,
    failedAt: null,
    firstValueAt: null,
    lastValueAt: null,
    valueDays: [],
    pauseUntil: null,
    timeline: [],
  };
  timeline(contact, actor, 'Account enrolled; activity unknown until product signals arrive.', now);
  state.contacts.push(contact);
  audit(state, actor, 'Enrolled a production account.', now);
  return contact;
}
export function updateContact(
  state: PlgState,
  id: string,
  input: Record<string, unknown>,
  actor: string,
  now: number,
): PlgContact {
  const c = state.contacts.find((item) => item.id === id);
  if (!c) throw new PlgError(404, 'Account not found.');
  for (const key of ['owner', 'blocker', 'notes'] as const)
    if (input[key] !== undefined) c[key] = text(input[key], key === 'notes' ? 400 : 120);
  if (c.permission && input.frequency !== undefined && input.frequency !== c.frequency)
    throw new PlgError(409, 'Manage the email frequency in the One account preference.');
  if (input.frequency !== undefined)
    c.frequency = choose(input.frequency, ['daily', 'weekly', 'updates']);
  if (input.supportOpen !== undefined) {
    if (typeof input.supportOpen !== 'boolean') throw new PlgError(400, 'Invalid support status.');
    c.supportOpen = input.supportOpen;
  }
  if (input.unsubscribe === true && (!c.suppressed || c.suppressed === 'unsubscribed')) c.suppressed = 'unsubscribed';
  if (input.outreach && typeof input.outreach === 'object') {
    const outreach = input.outreach as Record<string, unknown>;
    const channel = choose(outreach.channel, ['email', 'whatsapp']);
    const id = text(outreach.id, 80, true);
    if (!c.consentAt || c.suppressed || c.group === 'control')
      throw new PlgError(
        409,
        'Promotional outreach requires an eligible subscriber outside the comparison group.',
      );
    if (!state.deliveries.some((d) => d.key === `manual:${id}`)) {
      state.deliveries.push({
        id: randomUUID(),
        contactId: c.id,
        templateId: 'manual',
        step: 'manual',
        key: `manual:${id}`,
        status: 'manual',
        createdAt: iso(now),
        subject: `Recorded ${channel} follow-up`,
        body: '',
        ctaLabel: '',
        ctaUrl: '',
        providerId: null,
      });
      timeline(
        c,
        actor,
        `Recorded promotional ${channel} contact in the shared frequency limit.`,
        now,
      );
    }
  }
  timeline(c, actor, 'Updated follow-up details and preferences.', now);
  return c;
}
export function ingestEvent(state: PlgState, input: Record<string, unknown>, now: number) {
  const eventId = text(input.eventId, 128, true);
  if (seenEvent(state, eventId)) return { duplicate: true };
  if (input.environment !== 'production' || input.internal !== false)
    throw new PlgError(400, 'Only production customer events are accepted.');
  const accountId = text(input.accountId, 128, true);
  const c = state.contacts.find((item) => item.accountId === accountId);
  if (!c) throw new PlgError(404, 'Account is not enrolled.');
  if (choose(input.journey, plgJourneyOptions(state).map((j) => j.id)) !== c.journey)
    throw new PlgError(400, 'Event does not match the enrolled journey.');
  const at = Date.parse(text(input.occurredAt, 40, true));
  if (
    !Number.isFinite(at) ||
    at > now + 60_000 ||
    at < now - 7 * DAY ||
    at < Date.parse(c.enrolledAt)
  )
    throw new PlgError(400, 'Event timestamp is outside the accepted window.');
  const kind = choose(input.kind, [
    'observation_completed',
    'activity_observed',
    'setup_started',
    'task_completed',
    'task_failed',
    'help_requested',
  ]);
  if (kind === 'observation_completed' && input.verified !== true)
    throw new PlgError(400, 'An observation requires a verified complete product check.');
  if (kind === 'task_completed' && !['memory', 'mail'].includes(c.journey))
    throw new PlgError(400, 'This agent has no verified outcome adapter.');
  c.telemetryAt = iso(Math.max(at, Date.parse(c.telemetryAt ?? '1970-01-01')));
  if (kind === 'observation_completed')
    c.observationAt = iso(Math.max(at, Date.parse(c.observationAt ?? '1970-01-01')));
  if (kind === 'setup_started') c.setupAt = iso(at);
  if (kind === 'task_failed') c.failedAt = iso(at);
  if (kind === 'help_requested') c.supportOpen = true;
  if (kind === 'task_completed') {
    if (input.result !== 'success' || input.deliberate !== true || input.verified !== true)
      throw new PlgError(400, 'A completed task needs a verified deliberate success.');
    const actionId = text(input.actionId, 128, true);
    const actionKey = `action:${c.accountId}:${c.journey}:${actionId}`;
    if (state.eventIds.includes(actionKey)) return { duplicate: true };
    state.eventIds.push(actionKey);
    if (!c.firstValueAt || at < Date.parse(c.firstValueAt)) c.firstValueAt = iso(at);
    if (!c.lastValueAt || at > Date.parse(c.lastValueAt)) c.lastValueAt = iso(at);
    c.valueDays = [...new Set([...c.valueDays, iso(at).slice(0, 10)])].sort();
  }
  state.eventIds.push(eventKey(eventId));
  timeline(c, 'One product', kind.replaceAll('_', ' '), now);
  return { duplicate: false };
}
export function ingestEnrollment(state: PlgState, input: Record<string, unknown>, now: number) {
  const eventId = text(input.eventId, 128, true);
  if (seenEvent(state, eventId)) return { duplicate: true };
  const at = Date.parse(text(input.occurredAt, 40, true));
  if (!Number.isFinite(at) || at > now + 60_000 || at < now - 7 * DAY || input.cohort !== 'new')
    throw new PlgError(400, 'Invalid new-signup enrollment event.');
  const existing = state.contacts.find((c) => c.accountId === input.accountId);
  if (existing) return { duplicate: true };
  enroll(state, input, 'One product', at);
  state.eventIds.push(eventKey(eventId));
  return { duplicate: false };
}
export function contactStage(c: PlgContact, now: number): PlgStage {
  if (
    c.supportOpen ||
    (c.failedAt && (!c.lastValueAt || Date.parse(c.failedAt) > Date.parse(c.lastValueAt)))
  )
    return 'blocked';
  if (c.firstValueAt)
    return age(c.lastValueAt, now) >= 7 * DAY
      ? 'inactive'
      : c.valueDays.length > 1
        ? 'returning'
        : 'activated';
  const focus = c.journey === 'memory' ? 'agent_personal_information' : c.journey === 'mail' ? 'agent_email' : c.journey;
  if (c.activity?.agents.some((a) => (a.agentId === focus || focus === 'agent_one') && a.reported + a.executed > 0))
    return 'engaged';
  if (!c.telemetryAt) return 'unknown';
  return c.setupAt ? 'setup' : 'new';
}
export function customerReportingCurrent(state: Pick<PlgState, 'customerReporting'>, c: PlgContact, now: number) {
  const proof = c.customerReporting, policy = state.customerReporting;
  if (!proof || !policy || proof.policyRevision !== policy.policyRevision) return false;
  const checked = Date.parse(proof.checkedAt), current = Date.parse(policy.checkedAt);
  return Number.isFinite(checked) && Number.isFinite(current) &&
    checked <= now + 60_000 && current <= now + 60_000 &&
    now - checked <= DAY && now - current <= DAY;
}
export function customerReportingEligible(state: Pick<PlgState, 'customerReporting'>, c: PlgContact, now: number) {
  return c.customerReporting?.eligible === true && customerReportingCurrent(state, c, now);
}
export function candidate(
  state: PlgState,
  c: PlgContact,
  now: number,
  ignorePause = false,
): PlgCandidate {
  const policy = deliveryPolicy(c, state.deliveries);
  const base = candidateFromPolicy(state, c, policy, now, ignorePause);
  const proof = c.routingEvidence;
  // Preserve existing lifecycle decisions and one canonical account. A signed
  // positive outcome can select a published agent newsletter; it cannot prove
  // complete observation, abandonment, failure or any behavioral follow-up.
  if (c.journey !== 'agent_one' || !c.permission || !proof ||
    proof.generation !== c.permission.generation || !state.catalog ||
    !c.consentAt || !Number.isFinite(Date.parse(c.consentAt)) || contactStage(c, now) === 'blocked' ||
    !Number.isFinite(Date.parse(proof.checkedAt)) || age(proof.checkedAt, now) > DAY ||
    Date.parse(proof.checkedAt) > now + 60_000 ||
    (base.eligible && base.step !== 'newsletter')) return base;
  const agents = [...proof.agents].sort((a, b) =>
    b.lastAt.localeCompare(a.lastAt) || a.agentId.localeCompare(b.agentId));
  for (const evidence of agents) {
    const journey: PlgJourney = evidence.agentId === 'agent_personal_information' ? 'memory' :
      evidence.agentId === 'agent_email' ? 'mail' : evidence.agentId;
    const last = Date.parse(evidence.lastAt);
    if (!Number.isFinite(last) || last < Math.max(Date.parse(c.enrolledAt), Date.parse(c.consentAt)) || last < now - 7 * DAY ||
      last > now + 60_000 || !journeyOutcomeCoverage(state.catalog, journey).supported ||
      !outcomeProofMatches(state.catalog, evidence.agentId, evidence.proof)) continue;
    const projected: PlgContact = { ...c, journey, observationAt: null, activity: undefined,
      telemetryAt: null, setupAt: null, failedAt: null, firstValueAt: evidence.lastAt,
      lastValueAt: evidence.lastAt, valueDays: [evidence.lastAt.slice(0, 10)] };
    const next = candidateFromPolicy(state, projected, policy, now, ignorePause);
    if (next.eligible && next.step === 'newsletter') return { ...next, journey };
  }
  return base;
}

/** Policy inputs for one account; a repository need not reconstruct delivery history. */
export interface PlgDeliveryPolicy {
  unresolved: boolean;
  latestPromotions: readonly string[];
  latestStepAt: Partial<Record<PlgStep, string>>;
  lastReturnAt: string | null;
  claimedKeys: ReadonlySet<string>;
}

/** Compatibility projection for the bounded v1 store. Preserve reservation order. */
export function deliveryPolicy(c: PlgContact, deliveries: readonly PlgDelivery[]): PlgDeliveryPolicy {
  const history = deliveries.filter((d) => d.contactId === c.id);
  const latestStepAt: PlgDeliveryPolicy['latestStepAt'] = {};
  for (const d of history) {
    if (d.step === 'manual') continue;
    const previous = latestStepAt[d.step];
    if (!previous || Date.parse(d.createdAt) > Date.parse(previous)) latestStepAt[d.step] = d.createdAt;
  }
  return {
    unresolved: history.some((d) => d.status === 'sending' || d.status === 'uncertain'),
    latestPromotions: history.map((d) => d.createdAt).sort((a, b) => Date.parse(b) - Date.parse(a)).slice(0, 3),
    latestStepAt,
    lastReturnAt: history.filter((d) => d.step === 'return' && Date.parse(d.createdAt) >= Date.parse(c.lastValueAt ?? '')).at(-1)?.createdAt ?? null,
    claimedKeys: new Set(history.map((d) => d.key)),
  };
}

export function candidateFromPolicy(
  state: Pick<PlgState, 'paused' | 'catalog' | 'ready' | 'templates' | 'customerReporting'>,
  c: PlgContact,
  policy: PlgDeliveryPolicy,
  now: number,
  ignorePause = false,
): PlgCandidate {
  const stage = contactStage(c, now);
  const out: PlgCandidate = {
    contactId: c.id,
    stage,
    step: null,
    templateId: null,
    key: null,
    eligible: false,
    reason: '',
  };
  const stop = (reason: string) => ({ ...out, reason });
  if (c.suppressed) return stop(`Suppressed: ${c.suppressed}`);
  if (c.permission && (!c.permission.enabled || !c.permission.eligible))
    return stop('Current One email permission is unavailable or turned off');
  if (!customerReportingEligible(state, c, now))
    return stop('Production customer reporting verification is pending or excluded');
  if (!c.consentAt) return stop('Messaging permission not recorded');
  if (c.group === 'control') return stop('Comparison group; requested support remains available');
  if (state.paused && !ignorePause) return stop('Campaigns paused');
  if (!plgJourneyOptions(state).some((j) => j.id === c.journey)) return stop('Agent journey is unavailable');
  if (!state.ready[c.journey]) return stop('Journey task has not been verified');
  if (c.supportOpen) return stop('Assistance open; respond through requested support');
  if (c.pauseUntil && Date.parse(c.pauseUntil) > now) return stop('Follow-up pause active');
  if (c.frequency === 'updates') return stop('Product updates only; lifecycle messages disabled');
  // An observed activity is not an ongoing feed-health guarantee. Require a fresh
  // per-account observation before inferring the absence of a completed task.
  const freshObservation = age(c.observationAt, now) <= DAY;
  if (policy.unresolved)
    return stop('Delivery confirmation pending; automatic follow-up blocked');
  if (policy.latestPromotions.some((at) => age(at, now) < DAY))
    return stop('One promotional message per 24 hours');
  if (
    c.frequency === 'weekly' &&
    policy.latestPromotions.filter((at) => age(at, now) < 7 * DAY).length >= 3
  )
    return stop('Three promotional messages per seven days');
  const has = (step: PlgStep) =>
    Boolean(policy.latestStepAt[step] &&
      (!['repeat', 'return', 'feedback'].includes(step) ||
        Date.parse(policy.latestStepAt[step]!) >= Date.parse(c.lastValueAt ?? c.enrolledAt)));
  let step: PlgStep | null = null;
  if (!freshObservation) {
    if (stage === 'blocked') return stop('Task failed; PLG assistance review needed');
    // Neutral welcome and explicitly subscribed content do not assert inactivity.
    // Behavioral reminders still require complete, fresh product observations.
    if (
      !c.firstValueAt && stage !== 'engaged' &&
      !has('welcome') &&
      state.templates.some((t) => t.journey === c.journey && t.step === 'welcome' && t.published)
    )
      step = 'welcome';
  } else if (stage === 'blocked') {
    if (!has('help')) step = 'help';
    else return stop('Task failed; PLG assistance review needed');
  } else if (!c.firstValueAt) {
    if (age(c.enrolledAt, now) >= 3 * DAY) {
      if (!has('help')) step = 'help';
    } else if (age(c.enrolledAt, now) >= DAY) {
      if (!has('demo')) step = 'demo';
    } else if (!has('welcome')) step = 'welcome';
  } else if (stage === 'inactive') {
    const lastReturn = policy.lastReturnAt;
    if (!lastReturn) step = 'return';
    else if (age(lastReturn, now) >= 7 * DAY && !has('feedback')) step = 'feedback';
  } else if (age(c.firstValueAt, now) >= 2 * DAY && !has('repeat')) step = 'repeat';
  // An unsupported behavioral choice must not hide an eligible neutral newsletter.
  const outcomeHeld = Boolean(step && !['welcome', 'newsletter'].includes(step) &&
    !journeyOutcomeCoverage(state.catalog, c.journey).supported);
  if (outcomeHeld) step = null;
  if (!step) {
    const newsletter = state.templates.find(
      (t) => t.journey === c.journey && t.step === 'newsletter' && t.published,
    );
    if (
      newsletter &&
      !policy.claimedKeys.has(`${c.id}:${newsletter.id}:${newsletter.version}`) &&
      (c.frequency === 'daily' ||
        age(policy.latestStepAt.newsletter, now) >= 7 * DAY)
    )
      step = 'newsletter';
  }
  if (!step)
    return stop(
      outcomeHeld
        ? 'Verified journey outcome unavailable; behavioral follow-up held'
        : freshObservation
        ? 'No relevant message due'
        : 'Activity unknown or stale; review before behavioral follow-up',
    );
  const template = state.templates.find(
    (t) => t.journey === c.journey && t.step === step && t.published,
  );
  if (!template) return stop(`Publish the ${step} message before sending`);
  const key =
    step === 'newsletter'
      ? `${c.id}:${template.id}:${template.version}`
      : `${c.id}:${step}:${['repeat', 'return', 'feedback'].includes(step) ? c.lastValueAt : 'activation'}`;
  if (policy.claimedKeys.has(key))
    return stop('This journey step has already been reserved or sent');
  return {
    ...out,
    eligible: true,
    step,
    templateId: template.id,
    key,
    reason: `${step} message ready for review`,
  };
}
export function updateTemplate(
  state: PlgState,
  id: string,
  input: Record<string, unknown>,
  actor: string,
  now: number,
) {
  const t = state.templates.find((item) => item.id === id);
  if (!t) throw new PlgError(404, 'Message not found.');
  t.subject = text(input.subject, 180, true);
  if (/[\r\n]/.test(t.subject)) throw new PlgError(400, 'Invalid subject.');
  t.body = text(input.body, 3000, true);
  t.ctaLabel = text(input.ctaLabel, 80, true);
  t.ctaUrl = taskUrl(input.ctaUrl);
  t.resourceUrl = resourceUrl(input.resourceUrl);
  if (typeof input.published !== 'boolean') throw new PlgError(400, 'Invalid publication status.');
  t.published = input.published;
  t.version += 1;
  audit(state, actor, `Updated ${t.id} message version ${t.version}.`, now);
  return t;
}
export function metrics(state: PlgState, now: number) {
  state = { ...state, contacts: state.contacts.filter((c) => customerReportingEligible(state, c, now)) };
  const eligible = state.contacts.filter((c) => age(c.enrolledAt, now) >= 7 * DAY);
  const retention = state.contacts.filter(
    (c) => c.firstValueAt && Date.parse(c.firstValueAt.slice(0, 10)) + 15 * DAY <= now,
  );
  return {
    enrolled: state.contacts.length,
    observed: state.contacts.filter((c) => c.telemetryAt || c.activity?.agents.length).length,
    activated: state.contacts.filter((c) => c.firstValueAt).length,
    repeat: state.contacts.filter((c) => c.valueDays.length > 1).length,
    activationEligible: eligible.length,
    activationConverted: eligible.filter(
      (c) => c.firstValueAt && Date.parse(c.firstValueAt) - Date.parse(c.enrolledAt) <= 7 * DAY,
    ).length,
    retentionEligible: retention.length,
    retained: retention.filter((c) =>
      c.valueDays.some((day) => {
        const delta = Date.parse(day) - Date.parse(c.firstValueAt!.slice(0, 10));
        return delta >= 8 * DAY && delta < 15 * DAY;
      }),
    ).length,
  };
}
