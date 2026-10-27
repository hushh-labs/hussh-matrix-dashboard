/** Email-safe presentation only. Content, recipients and delivery policy stay with callers. */
interface PlgEmailContent {
  subject: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  resourceUrl?: string;
}
type PlgEmailLayout = PlgEmailContent & (
  { preferences: { manage: string; unsubscribe: string }; preview?: false } |
  { preferences?: never; preview: true }
);

export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export function renderPlgEmailHtml(input: PlgEmailLayout): string {
  const preheader = escapeHtml(input.body.replace(/\s+/g, ' ').trim().slice(0, 140));
  const paragraphs = input.body.split(/\r?\n\s*\r?\n/).map((paragraph) =>
    `<p style="margin:0 0 20px;color:#475569;font-size:16px;line-height:1.75;overflow-wrap:anywhere">${escapeHtml(paragraph).replace(/\r?\n/g, '<br>')}</p>`,
  ).join('');
  const footer = input.preferences
    ? `<p style="margin:0 0 10px;color:#64748b;font-size:13px;line-height:1.6">Your email preferences are always in your hands.</p>
       <p style="margin:0;font-size:13px;line-height:1.8"><a href="${escapeHtml(input.preferences.manage)}" style="color:#475569;text-decoration:underline">Email preferences</a><span style="color:#94a3b8"> &nbsp;&middot;&nbsp; </span><a href="${escapeHtml(input.preferences.unsubscribe)}" style="color:#475569;text-decoration:underline">Unsubscribe</a></p>`
    : '<p style="margin:0;color:#64748b;font-size:13px;line-height:1.6">Test preview &middot; Customer preferences are unchanged.</p>';
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.subject)}</title></head>
<body style="margin:0;padding:0;background-color:#f4f6fa;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;color:#0f172a">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all" aria-hidden="true">${preheader}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f4f6fa"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;table-layout:fixed">
<tr><td style="padding:0 8px 24px"><span style="font-size:28px;font-weight:700;letter-spacing:-1px;color:#0f172a">One<span style="color:#2563eb">.</span></span><br><span style="font-size:12px;line-height:1.8;letter-spacing:1px;color:#64748b">YOUR PRIVATE AGENT</span></td></tr>
<tr><td style="padding:32px 28px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:16px">
${input.preview ? '<p style="margin:0 0 20px;font-size:12px;line-height:1.5;font-weight:700;letter-spacing:1px;color:#92400e">PLG TEST PREVIEW</p>' : ''}
<h1 style="margin:0 0 24px;font-size:28px;line-height:1.25;font-weight:700;letter-spacing:-0.7px;color:#0f172a;overflow-wrap:anywhere">${escapeHtml(input.subject)}</h1>
${paragraphs}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="max-width:100%;margin:8px 0"><tr><td align="center" bgcolor="#1d4ed8" style="background-color:#1d4ed8;border-radius:10px;mso-padding-alt:16px 24px"><a href="${escapeHtml(input.ctaUrl)}" style="display:inline-block;max-width:100%;box-sizing:border-box;padding:16px 24px;color:#ffffff;font-size:16px;line-height:1.5;font-weight:700;text-decoration:none;border-radius:10px;overflow-wrap:anywhere">${escapeHtml(input.ctaLabel)}</a></td></tr></table>
${input.resourceUrl ? `<p style="margin:20px 0 0;font-size:14px;line-height:1.6"><a href="${escapeHtml(input.resourceUrl)}" style="color:#1d4ed8;text-decoration:underline">View the demo or guide</a></p>` : ''}
</td></tr>
<tr><td style="padding:28px 8px 0">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 12px"><tr><td width="32" style="width:32px;padding-right:10px"><img src="https://metrics.hussh.ai/assets/hussh-mark.png" width="32" height="32" alt="" style="display:block;width:32px;height:32px;border:0;outline:none"></td><td style="font-size:21px;line-height:1.4;font-weight:700;letter-spacing:-0.5px;color:#334155">hussh</td></tr></table>
<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#64748b">One, your private agent.</p>
${footer}
<p style="margin:16px 0 0;font-size:12px;line-height:1.8"><a href="https://www.hushh.ai/privacy" style="color:#64748b;text-decoration:underline">Privacy policy</a><span style="color:#94a3b8"> &nbsp;&middot;&nbsp; </span><a href="https://www.hushh.ai/terms" style="color:#64748b;text-decoration:underline">Terms of use</a></p>
<p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#64748b">&copy; hussh</p>
</td></tr>
</table></td></tr></table></body></html>`;
}
