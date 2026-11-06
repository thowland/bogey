// Overlays, field values and their history belong to one document (spec §7.4). When another
// document starts opening, or the document closes, the edits, the selection, any text being typed,
// the last point clicked and the snippet target field are cleared, so nothing from the previous
// file shows on, or lands in, the next. Restoring saved work (Sprint 6) loads the
// edits after this, once the new document is open.
import { useDocumentStore, type DocumentStatus } from '../../state/document.ts';
import { useEditsStore } from '../../state/edits.ts';
import { useViewStore } from '../../state/view.ts';
import { useOverlayUi } from './overlayUi.ts';

const CLEARS: readonly DocumentStatus[] = ['opening', 'empty'];

export function clearDocumentEdits(): void {
  useEditsStore.getState().reset();
  useOverlayUi.getState().setEditing(null);
  const view = useViewStore.getState();
  view.select(null);
  view.setLastPoint(null);
  view.setTargetField(null);
}

useDocumentStore.subscribe((state, previous) => {
  if (state.status !== previous.status && CLEARS.includes(state.status)) clearDocumentEdits();
});
