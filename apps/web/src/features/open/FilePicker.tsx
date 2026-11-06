// The file picker (D1): a hidden file input that a visible button opens. Choosing a file starts the
// open sequence; the input is cleared so the same file can be chosen again. With `shortcut`, the
// picker also answers Cmd/Ctrl+O (U2); Safari keeps Cmd+O for itself, so there the button is the
// way in (spec §10.4).
import { useEffect, useRef, type ChangeEvent } from 'react';
import { Button, type ButtonProps } from '../../ui/Button.tsx';
import { openDocument } from './openDocument.ts';

type ShortcutKeys = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>;

export const isOpenShortcut = (event: ShortcutKeys) =>
  (event.metaKey || event.ctrlKey) &&
  !event.altKey &&
  !event.shiftKey &&
  event.key.toLowerCase() === 'o';

export type FilePickerProps = Omit<ButtonProps, 'onClick'> & { shortcut?: boolean };

export function FilePicker({ children, shortcut = false, ...buttonProps }: FilePickerProps) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!shortcut) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isOpenShortcut(event)) return;
      event.preventDefault();
      input.current?.click();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcut]);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void openDocument(file);
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        data-testid={shortcut ? 'open-input' : undefined}
        onChange={onChange}
      />
      <Button
        {...buttonProps}
        aria-keyshortcuts={shortcut ? 'Meta+O Control+O' : undefined}
        onClick={() => input.current?.click()}
      >
        {children}
      </Button>
    </>
  );
}
