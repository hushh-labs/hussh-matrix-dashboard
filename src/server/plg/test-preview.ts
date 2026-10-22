import { plgSteps, type PlgDelivery, type PlgTemplate } from '../../lib/plg';
import { choose, PlgError, resourceUrl, taskUrl, text } from './engine';

/** Render only. The caller owns authorization, fixed recipient and a separate test ledger. */
export function renderPlgTestPreview(template: PlgTemplate): Pick<PlgDelivery, 'subject' | 'body' | 'ctaLabel' | 'ctaUrl' | 'resourceUrl'> {
  const step = choose(template.step, plgSteps);
  const subject = text(template.subject, 180, true);
  if (/[\r\n]/.test(subject)) throw new PlgError(400, 'Invalid test email subject.');
  const body = text(template.body, 3000, true);
  const action = text(template.ctaLabel, 80, true);
  const url = taskUrl(template.ctaUrl);
  const resource = resourceUrl(template.resourceUrl);
  return {
    subject: `[PLG TEST] ${step.toUpperCase()}: ${subject}`,
    body: [
      `PLG TEST PREVIEW — ${step}`,
      'This is a requested operator-only preview of draft content. It does not attest a product action, assess your activity, enroll you in campaigns, or change customer measurements.',
      body,
      'This preview does not subscribe you to automatic marketing emails. Real customer preference and unsubscribe links are not fabricated in a content preview.',
    ].join('\n\n'),
    ctaLabel: action,
    ctaUrl: url,
    resourceUrl: resource,
  };
}
