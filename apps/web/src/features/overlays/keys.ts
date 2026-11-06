// Keyboard shortcuts for tools, history and overlays (U2, O7, O8, spec §7.4, §10.4).
import type { Tool } from '../../state/view.ts';
import { isTyping } from '../viewer/keys.ts';

type Keyish = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'target'>;

const TOOL_KEYS: Readonly<Record<string, Tool>> = {
  v: 'select',
  t: 'text',
  c: 'check',
  d: 'date',
  s: 'signature',
};

/** T, C, D, S and V choose a tool; Escape returns to select. Nothing while typing. */
export function toolForKey(event: Keyish): Tool | null {
  if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return null;
  if (event.key === 'Escape') return 'select';
  if (event.shiftKey) return null;
  return TOOL_KEYS[event.key.toLowerCase()] ?? null;
}

/**
 * Cmd/Ctrl+Z undoes, Cmd/Ctrl+Shift+Z and Ctrl+Y redo. Inside a native text control the
 * browser's own undo runs instead (spec §7.4).
 */
export function historyKey(event: Keyish): 'undo' | 'redo' | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || isTyping(event.target)) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey) return 'redo';
  return null;
}

/** Delete or Backspace, outside text controls. */
export function isDeleteKey(event: Keyish): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return false;
  return event.key === 'Delete' || event.key === 'Backspace';
}

/** Arrow keys nudge 1 pt, with Shift 10 pt, in screen directions (O7). */
export function nudgeForKey(event: Keyish): { right: number; down: number } | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const step = event.shiftKey ? 10 : 1;
  switch (event.key) {
    case 'ArrowLeft':
      return { right: -step, down: 0 };
    case 'ArrowRight':
      return { right: step, down: 0 };
    case 'ArrowUp':
      return { right: 0, down: -step };
    case 'ArrowDown':
      return { right: 0, down: step };
    default:
      return null;
  }
}

/** Whether the event happened inside an open dialog, where page shortcuts do not apply. */
export function inDialog(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('dialog') !== null;
}
