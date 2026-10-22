import { describe, expect, it } from 'vitest';
import { selfTestMessages } from '../scripts/send-plg-self-test';

describe('isolated operator email previews', () => {
  it('keeps all seven draft previews on the one configured mailbox without campaign tokens', () => {
    const rows = selfTestMessages('operator@example.com', 'replies@example.com', 'all');
    expect(rows).toHaveLength(7);
    expect(new Set(rows.map((r) => r.tags[0].value)).size).toBe(7);
    for (const row of rows) {
      expect(row.to).toEqual(['operator@example.com']);
      expect(row.from).toBe('One PLG testing <onboarding@resend.dev>');
      expect(row.subject).toMatch(/^\[TEST/);
      expect(row.text).not.toMatch(/integrations\/plg\/preferences|integrations\/plg\/unsubscribe/);
      expect(row.text).toContain('does not assess your activity');
    }
  });
  it('refuses multiple recipients, header injection and unknown steps', () => {
    for (const recipient of ['a@example.com,b@example.com', 'a@example.com\r\nBcc:b@example.com', '']) expect(() => selfTestMessages(recipient, 'replies@example.com', 'all')).toThrow();
    expect(() => selfTestMessages('operator@example.com', 'replies@example.com', 'arbitrary')).toThrow();
  });
  it('can run the welcome delivery check before the remaining previews', () => {
    const rows = selfTestMessages('operator@example.com', 'replies@example.com', 'welcome');
    expect(rows).toHaveLength(1);
    expect(rows[0].tags[0].value).toBe('welcome');
  });
});
