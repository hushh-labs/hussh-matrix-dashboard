/** Private read-only continuations, bound to the operator, view and storage generation. */
import type { PlgWorkspace } from '../../lib/plg';
import { PlgError } from './engine';
import { equalSignature, signValue } from './service';
import { validateAccountReportQuery, type AccountReportQuery } from './account-report';

interface PageRequest { query?: string; filter?: AccountReportQuery['filter']; contactId?: string | null; queueCursor?: string | null; historyCursor?: string | null }
type Kind = 'queue' | 'history';
const invalid = (): never => { throw new PlgError(400, 'This campaign page expired or belongs to another view. Restart the view.'); };
const binding = (body: PageRequest, actor: string, kind: Kind) => JSON.stringify(kind === 'queue'
  ? [actor, kind, body.query ?? '', body.filter ?? 'all', body.contactId ?? null] : [actor, kind]);
function token(value: unknown, secret: string) {
  if (secret.length < 32) throw new PlgError(503, 'Campaign page signing is unavailable.');
  const encoded = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encoded}.${signValue(`workspace-page:${encoded}`, secret)}`;
}
export function decodeWorkspacePage(body: unknown, actor: string, secret: string, now = Date.now()): AccountReportQuery {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
    Object.keys(body).some(key => !['query', 'filter', 'contactId', 'queueCursor', 'historyCursor'].includes(key))) invalid();
  const request = body as PageRequest;
  const query: AccountReportQuery = { query: request.query ?? '', filter: request.filter ?? 'all', contactId: request.contactId ?? null };
  validateAccountReportQuery(query);
  for (const kind of ['queue', 'history'] as const) {
    const cursor = kind === 'queue' ? request.queueCursor : request.historyCursor;
    if (cursor == null) continue;
    if (secret.length < 32 || typeof cursor !== 'string' || cursor.length > 2048) invalid();
    const parts = cursor.split('.');
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
      !equalSignature(parts[1], signValue(`workspace-page:${parts[0]}`, secret))) invalid();
    let value: any;
    try { value = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); } catch { invalid(); }
    if (!value || value.kind !== kind || value.binding !== binding(request, actor, kind) ||
      !Number.isSafeInteger(value.expires) || value.expires <= now || value.expires > now + 30 * 60_000 ||
      !/^[a-f0-9]{64}$/.test(value.generation ?? '') || query.generation && query.generation !== value.generation) invalid();
    query.generation = value.generation;
    if (kind === 'queue') query.after = value.after;
    else query.historyAfter = value.after;
    // A signed but malformed position is still rejected by the storage boundary.
    if (value.after == null) invalid();
  }
  validateAccountReportQuery(query);
  return query;
}
export function encodeWorkspacePages(workspace: PlgWorkspace, query: AccountReportQuery, actor: string, secret: string, now = Date.now()) {
  const report = workspace.state.storage?.report, generation = workspace.state.storage?.generation;
  if (!report) return workspace;
  if (!/^[a-f0-9]{64}$/.test(generation ?? '')) throw new PlgError(503, 'Campaign storage did not confirm its page generation.');
  const encode = (kind: Kind, after: unknown) => after == null ? null : token({ kind, after, generation,
    binding: binding(query, actor, kind), expires: now + 30 * 60_000 }, secret);
  return { ...workspace, pages: { asOf: report.asOf, contacts: { next: encode('queue', report.contacts.nextAfter),
    matches: report.contacts.matches, checked: report.contacts.checked }, history: { next: encode('history', report.history.nextAfter) } } };
}
