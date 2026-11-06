import { FilePicker } from './FilePicker.tsx';

/** The toolbar's Open button and the Cmd/Ctrl+O shortcut (D1, U2). */
export function OpenButton() {
  return <FilePicker shortcut>Open PDF</FilePicker>;
}
