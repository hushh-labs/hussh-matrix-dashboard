/** Only unique, bounded metadata headers; no mailbox content is retained. */
export const validRfcMessageId = (value: unknown): value is string => typeof value === 'string' &&
  /^<[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]{1,200}@[a-zA-Z0-9.-]{1,200}>$/.test(value);
export function googleMessageMetadata(value: any) {
  const headers = value?.payload?.headers;
  const field = (name: string): string | null => {
    if (!Array.isArray(headers)) return null;
    const matches = headers.filter((h) => typeof h?.name === 'string' && h.name.toLowerCase() === name);
    return matches.length === 1 && typeof matches[0].value === 'string' ? matches[0].value.trim() : null;
  };
  const messageId = field('message-id'), from = field('from'), to = field('to')?.toLowerCase();
  if (!validRfcMessageId(messageId) || !from || !to || !/^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/.test(to)) return null;
  return { messageId, from, to };
}
