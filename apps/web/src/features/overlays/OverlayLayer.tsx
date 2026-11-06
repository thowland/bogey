// The overlay layer over the current page (O1, O2, O7, N2, spec §7.2). It sits above the field
// layer in the same page sheet. In select mode the layer itself takes no pointer events, so field
// controls underneath keep working, and only overlays (and their handles) can be clicked; a
// capture-phase listener on the sheet still records the last point clicked for snippets (N2) and
// clears the selection when the click was not on an overlay. In a placement tool the layer takes
// every click on the page, and a tap places the tool's overlay.
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
  const geometry = useDocumentStore((state) => state.info?.pages[pageIndex]);
  const overlays = useEditsStore((state) => state.present.overlays);
  const editingId = useOverlayUi((state) => state.editingId);
  const draft = useOverlayUi((state) => state.draft);
  const root = useRef<HTMLDivElement>(null);
  const down = useRef<PointerSample | null>(null);

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
              if (event.button === 0) down.current = local(event);
            }
          : undefined
      }
      onPointerUp={
        placing
          ? (event) => {
              const start = down.current;
              down.current = null;
              const end = local(event);
              if (start && isTap(start, end)) placeAt(end, zoom);
            }
          : undefined
      }
      onPointerCancel={() => {
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
      const geometry = useDocumentStore.getState().info?.pages[view.page];
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
