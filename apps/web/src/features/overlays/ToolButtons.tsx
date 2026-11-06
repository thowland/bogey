// The tool buttons and the selected overlay's properties (O2–O5, U2, spec §7.2, §13). The tool
// keyboard shortcuts live here too, since the toolbar is always mounted.
import { useEffect } from 'react';
import { CHECK, TEXT } from '../../core-bridge/model.ts';
import { useDocumentStore } from '../../state/document.ts';
import { useEditsStore } from '../../state/edits.ts';
import { useViewStore, type Tool } from '../../state/view.ts';
import { Button } from '../../ui/Button.tsx';
import {
  TOOL_NAMES,
  chooseTool,
  deleteOverlay,
  patchOverlay,
  redoEdit,
  selectedOverlay,
  setSize,
  undoEdit,
} from './actions.ts';
import { historyKey, inDialog, isDeleteKey, toolForKey } from './keys.ts';
import { useOverlayUi } from './overlayUi.ts';
import styles from './Toolbar.module.css';

const TOOLS: readonly { tool: Tool; key: string }[] = [
  { tool: 'select', key: 'V' },
  { tool: 'text', key: 'T' },
  { tool: 'check', key: 'C' },
  { tool: 'date', key: 'D' },
  { tool: 'signature', key: 'S' },
];

const range = (min: number, max: number) =>
  Array.from({ length: max - min + 1 }, (_, i) => min + i);

export function ToolButtons() {
  const ready = useDocumentStore((state) => state.status === 'ready');
  const tool = useViewStore((state) => state.tool);
  const announcement = useOverlayUi((state) => state.announcement);
  useShortcuts(ready);

  return (
    <>
      <div className={styles.group} role="group" aria-label="Tools">
        {TOOLS.map(({ tool: t, key }) => (
          <Button
            key={t}
            variant="quiet"
            pressed={tool === t}
            disabled={!ready}
            title={`${TOOL_NAMES[t]} (${key})`}
            aria-keyshortcuts={key}
            onClick={() => chooseTool(t)}
          >
            {TOOL_NAMES[t]}
          </Button>
        ))}
      </div>
      {ready && <Properties />}
      <span className="visually-hidden" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}

/** Size and bold for text and dates, mark and size for checks (O3–O5). */
function Properties() {
  const id = useViewStore((state) => state.selectedOverlayId);
  const overlay = useEditsStore((state) => state.present.overlays.find((o) => o.id === id));
  const setGlyph = useOverlayUi((state) => state.setGlyph);
  if (!overlay || overlay.type === 'signature') return null;

  const sizes =
    overlay.type === 'check'
      ? range(CHECK.minSize, CHECK.maxSize)
      : range(TEXT.minSize, TEXT.maxSize);
  return (
    <div className={styles.group} role="group" aria-label="Selected overlay">
      <label className={styles.field}>
        <span>Size</span>
        <select
          value={overlay.size}
          onChange={(event) => setSize(overlay, Number(event.target.value))}
        >
          {sizes.map((size) => (
            <option key={size} value={size}>
              {size} pt
            </option>
          ))}
        </select>
      </label>
      {overlay.type === 'check' ? (
        (['check', 'x'] as const).map((glyph) => (
          <Button
            key={glyph}
            variant="quiet"
            pressed={overlay.glyph === glyph}
            onClick={() => {
              setGlyph(glyph);
              patchOverlay(overlay.id, { glyph });
            }}
          >
            {glyph === 'check' ? '✓ Check' : '✗ X'}
          </Button>
        ))
      ) : (
        <Button
          variant="quiet"
          pressed={overlay.bold}
          onClick={() => patchOverlay(overlay.id, { bold: !overlay.bold })}
        >
          Bold
        </Button>
      )}
    </div>
  );
}

/**
 * T, C, D, S, V and Escape choose tools; Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z undo and redo; Delete
 * and Backspace remove the selected overlay (U2, O7, O8). None of them act while typing in a text
 * control or inside a dialog.
 */
function useShortcuts(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || inDialog(event.target)) return;
      if (useViewStore.getState().screen !== 'workspace') return;
      const history = historyKey(event);
      if (history) {
        event.preventDefault();
        if (history === 'undo') undoEdit();
        else redoEdit();
        return;
      }
      if (isDeleteKey(event)) {
        const overlay = selectedOverlay();
        if (overlay) {
          event.preventDefault();
          deleteOverlay(overlay.id);
        }
        return;
      }
      const tool = toolForKey(event);
      if (tool) {
        event.preventDefault();
        if (event.key === 'Escape') useViewStore.getState().select(null);
        chooseTool(tool);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ready]);
}
