// Undo and redo buttons (O8). The keyboard shortcuts are in ToolButtons.
import { useDocumentStore } from '../../state/document.ts';
import { useEditsStore } from '../../state/edits.ts';
import { Button } from '../../ui/Button.tsx';
import { redoEdit, undoEdit } from './actions.ts';
import styles from './Toolbar.module.css';

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function UndoRedo() {
  const ready = useDocumentStore((state) => state.status === 'ready');
  const canUndo = useEditsStore((state) => state.canUndo);
  const canRedo = useEditsStore((state) => state.canRedo);
  const mod = isMac() ? '⌘' : 'Ctrl+';
  return (
    <div className={styles.group} role="group" aria-label="History">
      <Button
        variant="quiet"
        disabled={!ready || !canUndo}
        title={`Undo (${mod}Z)`}
        aria-keyshortcuts="Control+Z Meta+Z"
        onClick={undoEdit}
      >
        Undo
      </Button>
      <Button
        variant="quiet"
        disabled={!ready || !canRedo}
        title={`Redo (${mod}Shift+Z)`}
        aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
        onClick={redoEdit}
      >
        Redo
      </Button>
    </div>
  );
}
