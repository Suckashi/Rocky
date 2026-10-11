import { describe, expect, it } from 'vitest';
import { isActivatable, isEditable } from '../../src/web/keys.ts';

const el = (
  tagName: string,
  attrs: Record<string, string> = {},
  editable = false,
) => ({
  tagName,
  isContentEditable: editable,
  getAttribute: (name: string) => attrs[name] ?? null,
});

describe('panel shortcut targets', () => {
  it('leaves Enter to focused buttons and links', () => {
    expect(isActivatable(el('BUTTON'))).toBe(true);
    expect(isActivatable(el('A'))).toBe(true);
    expect(isActivatable(el('DIV', { role: 'button' }))).toBe(true);
    expect(isActivatable(el('SPAN', { role: 'link' }))).toBe(true);
    expect(isActivatable(el('SUMMARY'))).toBe(true);
    // The panel itself (focused when a question arrives) is not a control.
    expect(isActivatable(el('SECTION'))).toBe(false);
    expect(isActivatable(null)).toBe(false);
  });

  it('leaves every key to fields', () => {
    expect(isEditable(el('INPUT'))).toBe(true);
    expect(isEditable(el('TEXTAREA'))).toBe(true);
    expect(isEditable(el('SELECT'))).toBe(true);
    expect(isEditable(el('DIV', {}, true))).toBe(true);
    expect(isEditable(el('BUTTON'))).toBe(false);
  });
});
