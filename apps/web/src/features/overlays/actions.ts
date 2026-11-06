// What the overlay tools do to the stores (O2–O8, spec §7.2–§7.4). Components call these; the
// geometry is in model.ts and every change goes through state/edits.ts, so it can be undone.
import type { Overlay, PageGeometry, Point } from '@bogey/core';
import { formatDate } from '../../core-bridge/text.ts';
import { useDocumentStore } from '../../state/document.ts';
import { useEditsStore } from '../../state/edits.ts';
import { useSettingsStore } from '../../state/settings.ts';
import { useSignaturesStore } from '../../state/signatures.ts';
import { useViewStore, type Tool } from '../../state/view.ts';
import { nudgedAnchor, placeOverlay, sizePatch, type PlacementTool } from './model.ts';
import { useOverlayUi } from './overlayUi.ts';

export const TOOL_NAMES: Readonly<Record<Tool, string>> = {
  select: 'Select',
  text: 'Text',
  check: 'Check',
  date: 'Date',
  signature: 'Signature',
};

/** The page shown, with its geometry; null without a document. */
export function currentPage(): { index: number; geometry: PageGeometry } | null {
  const info = useDocumentStore.getState().info;
  const index = useViewStore.getState().page;
  const geometry = info?.pages[index];
  return geometry ? { index, geometry } : null;
}

const today = () => {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
};

/**
 * Chooses a tool (O2). The signature tool needs a signature from the library: with one chosen
 * before, it is placed again; otherwise the Signatures panel opens to choose one (G5).
 */
export function chooseTool(tool: Tool): void {
  const view = useViewStore.getState();
  const ui = useOverlayUi.getState();
  if (tool === 'signature') {
    const id = view.selectedSignatureId;
    const known = id !== null && useSignaturesStore.getState().images.has(id);
    if (!known) {
      view.chooseSignature(null);
      view.setPanel(true, 'signatures');
      ui.announce('Choose a signature in the Signatures panel, then click the page.');
      return;
    }
    view.chooseSignature(id);
  } else {
    view.setTool(tool);
  }
  ui.announce(
    tool === 'select' ? 'Select tool' : `${TOOL_NAMES[tool]} tool: click the page to place it`,
  );
}

/**
 * Places an overlay where the page was tapped in a placement tool, then returns to select (O2).
 * A new text overlay opens for typing and joins the document once it has text, so an abandoned
 * click leaves nothing behind.
 */
export function placeAt(point: Point, zoom: number): void {
  const view = useViewStore.getState();
  const page = currentPage();
  if (!page || view.tool === 'select') return;
  const tool: PlacementTool = view.tool;
  const signatureId = view.selectedSignatureId;
  const meta = useSignaturesStore.getState().items.find((item) => item.id === signatureId);
  const overlay = placeOverlay(tool, page.geometry, point, zoom, {
    id: crypto.randomUUID(),
    page: page.index,
    textSize: useSettingsStore.getState().defaultFontSize,
    dateText: formatDate(today(), useSettingsStore.getState().dateFormat),
    glyph: useOverlayUi.getState().glyph,
    signature: meta ? { id: meta.id, width: meta.width, height: meta.height } : null,
  });
  view.setTool('select');
  if (!overlay) {
    chooseTool('signature');
    return;
  }
  view.select(overlay.id);
  if (overlay.type === 'text') {
    useOverlayUi.getState().setEditing(overlay.id, overlay);
    return;
  }
  useEditsStore.getState().edit({ type: 'addOverlay', overlay });
  useOverlayUi.getState().announce(`${TOOL_NAMES[overlay.type]} placed`);
}

/** Coalesces typing into one text overlay into one undo step per editing session (spec §7.4). */
export const textKey = (id: string) => `overlay-text:${id}`;
const nudgeKey = (id: string) => `overlay-nudge:${id}`;

/**
 * Sets the edited overlay's text. A draft (not yet in the document) is added with its first
 * character, in the same undo step as the typing that follows.
 */
export function setText(id: string, text: string): void {
  const edits = useEditsStore.getState();
  const ui = useOverlayUi.getState();
  if (ui.draft?.id === id) {
    if (text === '') return;
    edits.edit(
      { type: 'addOverlay', overlay: { ...ui.draft, text } },
      { coalesceKey: textKey(id) },
    );
    ui.setEditing(id, null);
    return;
  }
  edits.edit({ type: 'updateOverlay', id, patch: { text } }, { coalesceKey: textKey(id) });
}

/** Ends editing. Text that ends up empty removes the overlay. */
export function finishText(id: string): void {
  const edits = useEditsStore.getState();
  edits.seal();
  useOverlayUi.getState().setEditing(null);
  const overlay = edits.present.overlays.find((o) => o.id === id);
  if (!overlay) {
    // A draft that never got any text.
    if (useViewStore.getState().selectedOverlayId === id) useViewStore.getState().select(null);
    return;
  }
  if ((overlay.type === 'text' || overlay.type === 'date') && overlay.text.trim() === '') {
    edits.edit({ type: 'deleteOverlay', id });
    useViewStore.getState().select(null);
  }
}

export function startEditing(overlay: Overlay): void {
  if (overlay.type !== 'text' && overlay.type !== 'date') return;
  useViewStore.getState().select(overlay.id);
  useOverlayUi.getState().setEditing(overlay.id);
}

export function moveTo(id: string, at: Point): void {
  useEditsStore.getState().edit({ type: 'moveOverlay', id, x: at.x, y: at.y });
}

/** Arrow-key nudges coalesce per overlay (spec §7.4). */
export function nudge(overlay: Overlay, right: number, down: number): void {
  const page = currentPage();
  if (!page) return;
  const at = nudgedAnchor(page.geometry, overlay, right, down);
  useEditsStore
    .getState()
    .edit(
      { type: 'moveOverlay', id: overlay.id, x: at.x, y: at.y },
      { coalesceKey: nudgeKey(overlay.id) },
    );
}

export function patchOverlay(
  id: string,
  patch: Partial<Record<'x' | 'y' | 'size' | 'width' | 'height', number>> & {
    bold?: boolean;
    glyph?: 'check' | 'x';
  },
): void {
  useEditsStore.getState().edit({ type: 'updateOverlay', id, patch });
}

/** A new size from the toolbar, keeping the overlay's top-left corner in place. */
export function setSize(overlay: Overlay, size: number): void {
  const page = currentPage();
  const patch = page ? sizePatch(page.geometry, overlay, size) : null;
  if (patch) patchOverlay(overlay.id, patch);
}

export function deleteOverlay(id: string): void {
  useEditsStore.getState().edit({ type: 'deleteOverlay', id });
  if (useViewStore.getState().selectedOverlayId === id) useViewStore.getState().select(null);
  useOverlayUi.getState().announce('Overlay deleted');
}

/** The selected overlay, if it still exists. */
export function selectedOverlay(): Overlay | null {
  const id = useViewStore.getState().selectedOverlayId;
  return useEditsStore.getState().present.overlays.find((o) => o.id === id) ?? null;
}

export function undoEdit(): void {
  const edits = useEditsStore.getState();
  if (!edits.canUndo) return;
  edits.undo();
  useOverlayUi.getState().announce('Undone');
}

export function redoEdit(): void {
  const edits = useEditsStore.getState();
  if (!edits.canRedo) return;
  edits.redo();
  useOverlayUi.getState().announce('Redone');
}
