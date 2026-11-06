// Keyboard handling shared by the viewer's shortcuts (U2, spec §10.4).

/** Single-key shortcuts do nothing while the user is typing into a control. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'range', 'color'].includes(
      target.type,
    );
  }
  return false;
}

/** `[` and `]` page back and forward: -1, +1, or 0 for any other key. */
export function pageStep(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'target'>,
): -1 | 0 | 1 {
  if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return 0;
  if (event.key === '[') return -1;
  if (event.key === ']') return 1;
  return 0;
}
