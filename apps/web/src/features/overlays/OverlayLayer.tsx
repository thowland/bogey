// The overlay layer over the current page (O1, O2, O7, N2, spec §7.2). It sits above the field
// layer in the same page sheet. In select mode the layer itself takes no pointer events, so field
// controls underneath keep working, and only overlays (and their handles) can be clicked; a
// capture-phase listener on the sheet still records the last point clicked for snippets (N2) and
// clears the selection when the click was not on an overlay. In a placement tool the layer takes
// every click on the page, and a tap places the tool's overlay. A tap is one pointer, pressed and
// released within 6 CSS px and 400 ms; a pan, or a second finger joining (a pinch), places
// nothing (spec §7.2).
//
// The keyboard path (U4, spec §13): while a placement tool is chosen, a "Place here" button marks
// where the overlay will go (the last point clicked on this page, or near the top-left corner) and
// takes focus, so Enter places it; focus then moves to the new overlay, where the arrow keys nudge
// it and Delete removes it.
import { useEffect, useRef, type PointerEvent, type RefObject } from 'react';
import { useDocumentStore } from '../../state/document.ts';
import { useEditsStore } from '../../state/edits.ts';
import { useViewStore } from '../../state/view.ts';
import { TOOL_NAMES, placeAt } from './actions.ts';
import { isTap, keyboardPoint, pagePoint, type PointerSample } from './model.ts';
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
  const placeHere = useRef<HTMLButtonElement>(null);
  const focusPlaced = useRef(false);
  const placing = tool !== 'select';
  const lastPoint = useViewStore((state) => state.lastPoint);

  useLastPoint(root, geometry !== undefined && zoom !== null);

  // A placement tool moves focus to the marker; a keyboard placement moves it on to the overlay.
  // Leaving the tool without placing (Escape, V) returns focus to where it was before.
  const returnTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (placing) {
      const before = document.activeElement;
      if (before instanceof HTMLElement && before !== placeHere.current) returnTo.current = before;
      placeHere.current?.focus({ preventScroll: true });
      return;
    }
    const previous = returnTo.current;
    returnTo.current = null;
    if (!focusPlaced.current) {
      if (document.activeElement === document.body && previous?.isConnected) previous.focus();
      return;
    }
    focusPlaced.current = false;
    const id = useViewStore.getState().selectedOverlayId;
    const item = [...(root.current?.querySelectorAll<HTMLElement>('[data-overlay-id]') ?? [])].find(
      (element) => element.dataset.overlayId === id,
    );
    item?.querySelector<HTMLElement>('button, textarea')?.focus();
  }, [placing, tool]);

  if (!geometry || zoom === null) return null;

  const local = (event: PointerEvent<HTMLElement>): PointerSample => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top, t: event.timeStamp };
  };

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
      {placing && (
        <PlaceHere
          ref={placeHere}
          at={keyboardPoint(geometry, zoom, lastPoint?.page === pageIndex ? lastPoint.point : null)}
          label={`Place ${TOOL_NAMES[tool].toLowerCase()} here`}
          onPlace={(at) => {
            focusPlaced.current = true;
            placeAt(at, zoom);
          }}
        />
      )}
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
 * The keyboard's placement point, marked on the page. It takes no pointer events: a click on the
 * page places where it lands, as before.
 */
function PlaceHere({
  ref,
  at,
  label,
  onPlace,
}: {
  ref: RefObject<HTMLButtonElement | null>;
  at: { x: number; y: number };
  label: string;
  onPlace(at: { x: number; y: number }): void;
}) {
  return (
    <button
      ref={ref}
      type="button"
      className={styles.placeHere}
      style={{ left: at.x, top: at.y }}
      onClick={(event) => {
        event.stopPropagation();
        onPlace(at);
      }}
    >
      {label}
    </button>
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
