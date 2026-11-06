// The overlay layer over the current page (O1, O2, O7, N2, spec §7.2). It sits above the field
// layer in the same page sheet. In select mode the layer itself takes no pointer events, so field
// controls underneath keep working, and only overlays (and their handles) can be clicked; a
// capture-phase listener on the sheet still records the last point clicked for snippets (N2) and
// clears the selection when the click was not on an overlay. In a placement tool the layer takes
// every click on the page, and a tap places the tool's overlay. A tap is one pointer, pressed and
// released within 6 CSS px and 400 ms; a pan, or a second finger joining (a pinch), places
// nothing (spec §7.2).
import { useEffect, useRef, type PointerEvent, type RefObject } from 'react';
import { useDocumentStore } from '../../state/document.ts';
import { useEditsStore } from '../../state/edits.ts';
import { useViewStore } from '../../state/view.ts';
import { placeAt } from './actions.ts';
import { isTap, pagePoint, type PointerSample } from './model.ts';
import { OverlayItem } from './OverlayItem.tsx';
import { useOverlayUi } from './overlayUi.ts';
import styles from './Overlays.module.css';

export function OverlayLayer() {
  const pageIndex = useViewStore((state) => state.page);
  const zoom = useViewStore((state) => state.renderedZoom);
  const tool = useViewStore((state) => state.tool);
  const selectedId = useViewStore((state) => state.selectedOverlayId);
  const geometry = useDocumentStore((state) => state.info?.pages?.[pageIndex]);
  const overlays = useEditsStore((state) => state.present.overlays);
  const editingId = useOverlayUi((state) => state.editingId);
  const draft = useOverlayUi((state) => state.draft);
  const root = useRef<HTMLDivElement>(null);
  const down = useRef<(PointerSample & { id: number }) | null>(null);
  const pressed = useRef(new Set<number>());

  useLastPoint(root, geometry !== undefined && zoom !== null);

  if (!geometry || zoom === null) return null;

  const local = (event: PointerEvent<HTMLElement>): PointerSample => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top, t: event.timeStamp };
  };

  const placing = tool !== 'select';
  const shown = overlays.filter((o) => o.page === pageIndex);
  if (draft && draft.page === pageIndex && !shown.some((o) => o.id === draft.id)) shown.push(draft);

  return (
    <div
      ref={root}
      className={[styles.layer, placing ? styles.placing : ''].join(' ')}
      data-testid="overlay-layer"
      onPointerDown={
        placing
          ? (event) => {
              // A primary pointer starts afresh, so a release we never saw cannot block taps.
              if (event.isPrimary) pressed.current.clear();
              pressed.current.add(event.pointerId);
              down.current =
                event.button === 0 && pressed.current.size === 1
                  ? { ...local(event), id: event.pointerId }
                  : null;
            }
          : undefined
      }
      onPointerUp={
        placing
          ? (event) => {
              pressed.current.delete(event.pointerId);
              const start = down.current;
              if (start?.id !== event.pointerId) return;
              down.current = null;
              const end = local(event);
              if (!isTap(start, end)) return;
              placeAt(end, zoom);
              if (event.pointerType === 'touch' || event.pointerType === 'pen') swallowGhostClick();
            }
          : undefined
      }
      onPointerCancel={(event) => {
        pressed.current.delete(event.pointerId);
        down.current = null;
      }}
    >
      {shown.map((overlay) => (
        <OverlayItem
          key={overlay.id}
          overlay={overlay}
          page={geometry}
          zoom={zoom}
          selected={overlay.id === selectedId}
          editing={overlay.id === editingId}
        />
      ))}
    </div>
  );
}

/** How long after a touch placement the browser's compatibility click may still arrive. */
const GHOST_CLICK_MS = 600;

/**
 * After a finger or Pencil tap, the browser sends a click to whatever is under the tap once it
 * ends, and by then that is the new overlay with its Delete button: the click is dropped.
 */
function swallowGhostClick() {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), GHOST_CLICK_MS);
}

/**
 * Records `lastPoint` for snippet placement on a pointerdown anywhere on the page in select mode
 * (N2, spec §7.2), and clears the selection when the press was not on an overlay. The listener is
 * a native capture-phase one on the page sheet, so it sees presses on field controls without
 * taking them.
 */
function useLastPoint(root: RefObject<HTMLDivElement | null>, mounted: boolean) {
  useEffect(() => {
    const sheet = root.current?.parentElement ?? null;
    if (!mounted || !sheet) return;
    const onDown = (event: globalThis.PointerEvent) => {
      const view = useViewStore.getState();
      if (view.tool !== 'select' || view.renderedZoom === null) return;
      const geometry = useDocumentStore.getState().info?.pages?.[view.page];
      if (!geometry) return;
      const box = sheet.getBoundingClientRect();
      const point = { x: event.clientX - box.left, y: event.clientY - box.top };
      view.setLastPoint({ page: view.page, point: pagePoint(geometry, point, view.renderedZoom) });
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('[data-overlay-id]')) view.select(null);
    };
    sheet.addEventListener('pointerdown', onDown, { capture: true });
    return () => sheet.removeEventListener('pointerdown', onDown, { capture: true });
  }, [root, mounted]);
}
