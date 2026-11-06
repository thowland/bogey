// Every keyboard shortcut Bogey has (U2, spec §10.4), for the help dialog. The handlers live with
// their features (open, export, overlays, viewer, fields, snippets); this list is what the user
// reads, so add a line here whenever a feature adds a key.
import { isTyping } from '../viewer/keys.ts';

export interface Shortcut {
  /** Keys as shown; `Mod` is ⌘ on Apple devices and Ctrl elsewhere. */
  keys: readonly string[][];
  action: string;
}

export interface ShortcutGroup {
  title: string;
  items: readonly Shortcut[];
}

export const SHORTCUTS: readonly ShortcutGroup[] = [
  {
    title: 'Document',
    items: [
      {
        keys: [['Mod', 'O']],
        action: 'Open a PDF. Safari keeps this key for itself, so use the Open PDF button there.',
      },
      { keys: [['Mod', 'S']], action: 'Download the signed copy.' },
      { keys: [['['], [']']], action: 'Go to the previous or next page.' },
      { keys: [['?']], action: 'Show this list.' },
    ],
  },
  {
    title: 'Tools',
    items: [
      { keys: [['V']], action: 'Select.' },
      { keys: [['T']], action: 'Place text.' },
      { keys: [['C']], action: 'Place a check mark.' },
      { keys: [['D']], action: 'Place today’s date.' },
      { keys: [['S']], action: 'Place a signature from the library.' },
      { keys: [['Esc']], action: 'Go back to Select and clear the selection.' },
    ],
  },
  {
    title: 'Editing',
    items: [
      { keys: [['Mod', 'Z']], action: 'Undo.' },
      {
        keys: [
          ['Mod', 'Shift', 'Z'],
          ['Ctrl', 'Y'],
        ],
        action: 'Redo.',
      },
      { keys: [['Delete'], ['Backspace']], action: 'Delete the selected overlay.' },
      { keys: [['Arrow keys']], action: 'Move the selected overlay by 1 point.' },
      { keys: [['Shift', 'Arrow keys']], action: 'Move the selected overlay by 10 points.' },
      { keys: [['Enter']], action: 'Edit the selected text or date.' },
      { keys: [['Shift', 'Enter']], action: 'Start a new line while editing text.' },
      { keys: [['Enter'], ['Esc']], action: 'Finish editing text.' },
    ],
  },
  {
    title: 'Form fields and snippets',
    items: [
      {
        keys: [['Tab'], ['Shift', 'Tab']],
        action: 'Move to the next or previous field, across pages.',
      },
      {
        keys: [['Space']],
        action:
          'On a snippet’s move handle, pick it up or drop it; the up and down arrows move it, and Esc puts it back.',
      },
    ],
  },
];

/** Whether this device labels the command key ⌘ (Macs and iPads). */
export const isApple = (userAgent: string = globalThis.navigator?.userAgent ?? ''): boolean =>
  /Mac|iPhone|iPad|iPod/.test(userAgent);

/** A key's name as shown on this device. */
export const keyName = (key: string, apple: boolean): string =>
  key === 'Mod' ? (apple ? '⌘' : 'Ctrl') : key;

type Keyish = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'target'>;

/** `?` opens the list, except while typing or inside another dialog. */
export function isHelpKey(event: Keyish): boolean {
  if (event.key !== '?' || event.metaKey || event.ctrlKey || event.altKey) return false;
  if (isTyping(event.target)) return false;
  return !(event.target instanceof Element && event.target.closest('dialog') !== null);
}
