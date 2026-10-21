import { featureTrackingGap } from './agent-measurement-contract.mjs';

/** An exported record is evidence; an event declaration on its own is not. */
export function featureMeasurementState(key: string, sourceAvailable: boolean, instrumented: boolean, signals: number | null | undefined, declaredGap = false) {
  if (sourceAvailable && typeof signals === 'number' && signals > 0) return 'observed';
  if (declaredGap || !instrumented || featureTrackingGap(key)) return 'not_tracked';
  return sourceAvailable ? 'empty' : 'unavailable';
}

export function exactCount(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US') : '—';
}

export function eventsPerDevice(events: number | null, devices: number | null): string {
  if (events === null || devices === null || devices <= 0) return '—';
  return (events / devices).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function unclassifiedEvents(events: number | null, successes: number | null, expectedErrors: number | null, failures: number | null): number | null {
  if (events === null || successes === null || expectedErrors === null || failures === null) return null;
  return Math.max(0, events - successes - expectedErrors - failures);
}

export function eventVolumeExplanation(events: number | null, devices: number | null): string {
  return `${exactCount(events)} records from ${exactCount(devices)} device/browser IDs in this period. Repeats count again.`;
}

const activityDescriptions: Record<string, string> = {
  live_sharing: 'Sharing confirmations, including shares made during Check-In. Location views are counted separately.',
  location_viewed: 'Times a shared location was viewed. Repeat views count again.',
  check_in: 'Check-in steps and results. A check-in can also create a sharing confirmation.',
  check_out: 'Times a check-out was recorded.',
  sms_safety: 'SOS triggers recorded. This count does not confirm message delivery.',
  request_location: 'Location request steps, including sending, approval, denial and fulfilment.',
  public_sharing: 'Public-link activity, including creation, opening, sharing and removal.',
  contact_sync: 'Contact-sync activity, including automatic syncs. This counts activity, not contacts.',
  invitations: 'Invitation creation and sharing steps. Acceptance is a separate step.',
  circle_engagement: 'Circle activity, including creation, opening, joining and removal.',
  auth_started: 'Times a sign-in was started.',
  daily_signin: 'Sign-ins recorded. Repeat sign-ins count again.',
  phone_verified: 'Phone verification steps, including starts and results.',
  google_signin: 'Google sign-in starts and results recorded. One attempt can create several records.',
  profile_created: 'Profile creation recorded. Repeat records count again.',
  onboarding_completed: 'Account setup completions recorded.',
  portfolio_view: 'Times a portfolio was viewed.',
  ai_recommendation: 'Times a recommendation was viewed.',
  analysis_stream: 'Analysis starts recorded. Completion is a separate step.',
  receipt_parsed: 'Import parsing results. Saving the import is counted separately.',
  import_saved: 'Import saving results. Parsing is counted separately.',
  preferences_updated: 'Privacy preference updates recorded.',
  consent_action_submitted: 'Consent choices submitted. Their results are counted separately.',
  consent_action_outcome: 'Results of submitted consent choices.',
  consent_screen_viewed: 'Times the consent screen was loaded. Background loading is excluded.',
  data_unlock: 'Data access requests and results. One request can produce several records.',
  permission_granted: 'Permission grants recorded.',
  revocation_submitted: 'Consent withdrawal results, including successful and failed requests.',
  account_connect_started: 'Times a Gmail connection was started.',
  account_connected: 'Gmail connection results. Check the details for successful and failed results.',
  receipt_sync_requested: 'Gmail sync requests recorded.',
  receipt_sync: 'Sync queue results. Acceptance means processing can start.',
  receipt_sync_completed: 'Finished sync processing results, including success and failure.',
  mail_signin_screen_view: 'Times the Mail sign-in screen was viewed.',
  inbox_viewed: 'Times the signed-in inbox was viewed.',
  autocategory_applied: 'Receipt categorization activity recorded.',
  verification_checked: 'Advisor verification checks and status changes.',
  workspace_visited: 'Times the advisor workspace was visited.',
  strategy_requested: 'Advisor and strategy requests recorded.',
  client_handoff: 'Client handoffs are not tracked yet.',
  marketplace_browsed: 'Marketplace browsing recorded.',
  profile_viewed: 'Times a marketplace profile was viewed.',
  subscription_started: 'Subscriptions are not tracked yet.',
};

export function featureActivityDescription(key: string): string {
  if (activityDescriptions[key]) return activityDescriptions[key];
  for (const agent of ['memory', 'wallet', 'calendar', 'kyc', 'crm']) {
    if (key.startsWith(`${agent}_`)) return `Recorded ${key.slice(agent.length + 1).replaceAll('_', ' ')} activity. Repeated records count again.`;
  }
  return 'Matching activity recorded during the selected period.';
}

const activityLabels: Record<string, string> = {
  auth_started: 'Sign-in started', phone_verified: 'Phone verification steps', google_signin: 'Google sign-in steps',
  profile_created: 'Profile creation', onboarding_completed: 'Account setup completed',
  portfolio_view: 'Portfolio views', ai_recommendation: 'Recommendation views',
  receipt_parsed: 'Import parsing results', import_saved: 'Import saving results',
  data_unlock: 'Data access requests & results', permission_granted: 'Permissions granted',
  revocation_submitted: 'Consent withdrawal results', account_connected: 'Gmail connection results',
  receipt_sync: 'Sync queue results', receipt_sync_completed: 'Sync processing results',
  inbox_viewed: 'Inbox views', autocategory_applied: 'Receipt categorization',
};

export function featureActivityLabel(key: string, fallback: string): string {
  return activityLabels[key] ?? fallback;
}

const featureNotes: Record<string, string> = {
  live_sharing: 'Counts one_location_share_confirmed records. Check-In can also emit this event. These are confirmations, not unique sharing sessions or recipients; viewing a shared location is counted separately.',
  location_viewed: 'Counts one_location_journey_action with action=location_share_viewed. Repeated view records count again; they do not mean a new share was sent or a new person joined.',
  check_in: 'Counts check-in events and journey action nearby_check_in_result. A Check-In may also emit a sharing confirmation, so feature rows overlap.',
  check_out: 'Counts events matching check_out. These record the end of a check-in, not a new sharing session.',
  sms_safety: 'Counts one_location_sos_triggered records. An emitted trigger does not prove that an SMS was delivered.',
  request_location: 'Counts request-sent records and location_request journey actions, including approval, denial and fulfilment. Use the separate fulfilled-request KPI for confirmed fulfilment.',
  public_sharing: 'Counts public-link creation and public_link journey actions, including opens, shares and revocations. The total is not a count of new links.',
  contact_sync: 'Counts contact-sync records, including background sync and contact_sync journey actions. This is not a count of contacts or manual sync requests.',
  invitations: 'Counts circle-invite creation, contact_invitation journey actions and circle_code_shared. A handoff does not prove delivery or acceptance.',
  circle_engagement: 'Counts Circle creation and other circle journey actions such as opens, joins and removal. Use the Circle creation card for creation records.',
  auth_started: 'Counts auth_started and one_auth_started records. These are sign-in starts, not new registered accounts.',
  daily_signin: 'Counts auth_completed, one_auth_login_completed and auth_succeeded records. Repeat sign-ins count again.',
  phone_verified: 'Counts phone-verification starts and completions, including one_auth_phone_verified and one_phone_verified. The total includes multiple stages.',
  google_signin: 'Counts auth_started, auth_succeeded and auth_failed only with action=google, plus legacy Google sign-in events. These overlap general authentication rows. Starts and results are different records, not unique attempts or new accounts.',
  profile_created: 'Counts profile_created and one_auth_profile_created records. Registration totals come separately from Firebase Authentication.',
  onboarding_completed: 'Counts onboarding-completion records. Repeated records and legacy/current event names remain separate analytics records.',
  portfolio_view: 'Counts portfolio_viewed and one_finance_portfolio_viewed. These are screen views, not transactions or investment outcomes.',
  ai_recommendation: 'Counts recommendation_viewed and one_finance_recommendation_viewed. Viewing does not prove acceptance or action.',
  analysis_stream: 'Counts analysis_stream_started and one_finance_analysis_started. Starting a stream does not prove that analysis completed.',
  receipt_parsed: 'Counts import_parse_completed outcomes. Parsing and saving the same import are separate stages and must not be added as unique imports.',
  import_saved: 'Counts import_save_completed outcomes separately from parsing. Repeat save records are retained.',
  preferences_updated: 'Counts only one_consent_preferences_updated. Submitted consent actions, screen loads and background prefetches are reported separately.',
  consent_action_submitted: 'Counts consent_action_submitted. A submission does not prove a completed preference change or unlocked data.',
  consent_action_outcome: 'Counts consent_action_result. This describes the submitted consent action’s result, not necessarily a data unlock.',
  revocation_submitted: 'Counts consent_action_result only with action=revoke. Submitted attempts are excluded. These records also appear in general consent outcomes; a successful result does not state how many individual permissions were removed.',
  consent_screen_viewed: 'Counts consent_pending_loaded only when load_surface=screen. Background prefetches are excluded. This is a screen-load count, not changed consent.',
  data_unlock: 'Counts one_consent_data_unlocked, data_unlocked and one_consent_data_unlock_requested. The total includes requests and outcomes; result=success refers to the emitting stage. General consent action results are separate.',
  permission_granted: 'Counts permission_granted and one_consent_permission_granted records. Multiple grants from one device count again.',
  account_connect_started: 'Counts gmail_connect_started. An OAuth attempt does not prove a connected account.',
  account_connected: 'Counts gmail_connect_result only with action=complete, plus one_gmail_connected. OAuth start records are excluded.',
  receipt_sync_requested: 'Counts gmail_sync_requested. Requesting a sync does not prove it was accepted or finished.',
  receipt_sync: 'Counts gmail_sync_result only with action=queue. Success means the job was accepted, not completed.',
  receipt_sync_completed: 'Counts gmail_sync_result only with action=complete, plus one_gmail_receipt_synced. Processing completion is separate from queue acceptance.',
  mail_signin_screen_view: 'Counts hushh_mail_signin_screen_view. Sign-in screen views are separate from authenticated inbox views.',
  inbox_viewed: 'Counts only one_gmail_inbox_viewed records. Repeat visits count again.',
  autocategory_applied: 'Counts autocategory_applied, receipt_categorized and one_gmail_receipt_categorized records. Multiple stages or receipts can emit multiple records.',
  verification_checked: 'Counts advisor-verification status changes and checks. These do not all mean verification was approved.',
  workspace_visited: 'Counts advisor-workspace views. Repeat visits count again.',
  strategy_requested: 'Counts advisor request creation and strategy-request records. A request does not prove a strategy was delivered.',
  marketplace_browsed: 'Counts marketplace-browsing records. Repeated exploration counts again.',
  profile_viewed: 'Counts marketplace-profile views. A view does not prove a subscription or sale.',
};

export function featureMeasurementNote(key: string): string {
  if (featureNotes[key]) return featureNotes[key];
  for (const agent of ['memory', 'wallet', 'calendar', 'kyc', 'crm']) {
    if (key.startsWith(`${agent}_`)) {
      return `Counts one_${agent}_action with action=${key.slice(agent.length + 1)}. Repeated action records count again; result describes this action only.`;
    }
  }
  return 'Only matching exported events are counted. No recorded event does not prove no product use.';
}
