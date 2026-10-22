import { describe, expect, it } from 'vitest';
import { initialPlgState } from '../src/server/plg/engine';
import { renderPlgTestPreview } from '../src/server/plg/test-preview';

describe('provider-neutral operator email previews', () => {
  const template = () => initialPlgState().templates[0];
  it('renders all seven draft steps without enrolling or measuring the operator', () => {
    const state = initialPlgState();
    const before = structuredClone(state);
    const rows = state.templates.filter((t) => t.journey === 'memory').map(renderPlgTestPreview);
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['body', 'ctaLabel', 'ctaUrl', 'resourceUrl', 'subject']);
      expect(row.subject).toMatch(/^\[PLG TEST\] (WELCOME|DEMO|HELP|REPEAT|RETURN|FEEDBACK|NEWSLETTER):/);
      expect(row.body).toContain('does not attest a product action');
      expect(row.body).not.toMatch(/integrations\/plg\/(preferences|unsubscribe)/);
    }
    expect(state).toEqual(before);
  });
  it('rejects MIME header injection, invalid steps and unsafe destinations', () => {
    expect(() => renderPlgTestPreview({ ...template(), subject: 'Test\r\nBcc: someone@example.com' })).toThrow();
    expect(() => renderPlgTestPreview({ ...template(), step: 'arbitrary' as any })).toThrow();
    expect(() => renderPlgTestPreview({ ...template(), ctaUrl: 'https://attacker.example/collect' })).toThrow();
    expect(() => renderPlgTestPreview({ ...template(), resourceUrl: 'javascript:alert(1)' })).toThrow();
  });
  it('includes an approved reviewed resource as plain text', () => {
    expect(renderPlgTestPreview({ ...template(), resourceUrl: 'https://www.youtube.com/watch?v=demo' }).resourceUrl).toBe('https://www.youtube.com/watch?v=demo');
  });
});
