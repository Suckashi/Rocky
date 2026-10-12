// Keyboard shortcuts on panels listen on the window, so they must not take a key away from
// the control that has focus: Enter on a focused button or link activates that control, and
// keys typed into a field stay in the field.

type Target = {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
} | null;

const EDITABLE = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const ACTIVATABLE = new Set(['BUTTON', 'A', 'SUMMARY']);
const ACTIVATABLE_ROLES = new Set(['button', 'link', 'menuitem', 'tab']);

/** A field that takes typed keys (input, textarea, select, contenteditable). */
export function isEditable(target: EventTarget | Target): boolean {
  const t = target as Target;
  return !!t && (t.isContentEditable === true || EDITABLE.has(t.tagName ?? ''));
}

/** A control that Enter activates natively (button, link, summary, or one with that role). */
export function isActivatable(target: EventTarget | Target): boolean {
  const t = target as Target;
  if (!t) return false;
  const role = t.getAttribute?.('role');
  return (
    ACTIVATABLE.has(t.tagName ?? '') ||
    (role !== null && role !== undefined && ACTIVATABLE_ROLES.has(role))
  );
}
