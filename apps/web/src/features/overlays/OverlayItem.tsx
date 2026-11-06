// One overlay on the page (O3–O7, spec §7.2, §13): a focusable button drawn where export draws it,
// with a selection frame, a resize handle and a delete button when selected, and a borderless
// textarea in place of the text while a text or date overlay is edited.
import type { Overlay, PageGeometry, Point } from '@bogey/core';
import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { scaleFor } from '../../core-bridge/geometry.ts';
import { useSignaturesStore } from '../../state/signatures.ts';
import { useViewStore } from '../../state/view.ts';
import {
  deleteOverlay,
  finishText,
  moveTo,
  nudge,
  patchOverlay,
  setText,
  startEditing,
} from './actions.ts';
import { A20_PATH, BOX, glyphTransform, xStrokes } from './checkGlyph.ts';
import { nudgeForKey } from './keys.ts';
import { movedAnchor, overlayLabel, overlayRect, resizePatch, type ResizePatch } from './model.ts';
import { lineHeight } from './textMetrics.ts';
import styles from './Overlays.module.css';

export interface OverlayItemProps {
  overlay: Overlay;
  page: PageGeometry;
  zoom: number;
  selected: boolean;
  editing: boolean;
}

type Drag = { kind: 'move' | 'resize'; start: Point; pointerId: number };
type Preview = Point | ResizePatch;

/** Movement in CSS px below which a press on an overlay only selects it. */
const DRAG_THRESHOLD = 2;

export function OverlayItem({ overlay, page, zoom, selected, editing }: OverlayItemProps) {
  const select = useViewStore((state) => state.select);
  const signatureName = useSignaturesStore((state) =>
    overlay.type === 'signature'
      ? state.items.find((item) => item.id === overlay.signatureId)?.name
      : undefined,
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const drag = useRef<Drag | null>(null);
  const body = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(editing);

  // Back on the overlay after editing, so arrows and Delete apply to it.
  useEffect(() => {
    if (wasEditing.current && !editing && selected) body.current?.focus();
    wasEditing.current = editing;
  }, [editing, selected]);

  const shown = preview ? ({ ...overlay, ...preview } as Overlay) : overlay;
  const rect = overlayRect(page, shown, zoom);

  const begin = (kind: Drag['kind'], event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    select(overlay.id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = {
      kind,
      start: { x: event.clientX, y: event.clientY },
      pointerId: event.pointerId,
    };
  };

  const onMove = (event: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    const delta = { x: event.clientX - d.start.x, y: event.clientY - d.start.y };
    if (preview === null && Math.hypot(delta.x, delta.y) < DRAG_THRESHOLD) return;
    setPreview(
      d.kind === 'move'
        ? movedAnchor(page, overlay, delta, zoom)
        : resizePatch(page, overlay, delta, zoom),
    );
  };

  const onEnd = (event: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    drag.current = null;
    // A drag is one undo step, made on pointerup (spec §7.4).
    if (preview && event.type === 'pointerup') {
      if (d.kind === 'move') moveTo(overlay.id, preview);
      else patchOverlay(overlay.id, preview);
    }
    setPreview(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = nudgeForKey(event);
    if (step) {
      event.preventDefault();
      nudge(overlay, step.right, step.down);
    } else if (event.key === 'Enter' && (overlay.type === 'text' || overlay.type === 'date')) {
      event.preventDefault();
      startEditing(overlay);
    }
  };

  const label = overlayLabel(overlay, signatureName);
  return (
    <div
      className={styles.item}
      data-overlay-id={overlay.id}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      {editing && (overlay.type === 'text' || overlay.type === 'date') ? (
        <TextEditor overlay={overlay} k={scaleFor(page, zoom)} label={label} />
      ) : (
        <button
          ref={body}
          type="button"
          className={styles.body}
          aria-label={label}
          aria-pressed={selected}
          onFocus={() => select(overlay.id)}
          onPointerDown={(event) => begin('move', event)}
          onPointerMove={onMove}
          onPointerUp={onEnd}
          onPointerCancel={onEnd}
          onDoubleClick={() => startEditing(overlay)}
          onKeyDown={onKeyDown}
        >
          <Visual overlay={shown} k={scaleFor(page, zoom)} />
        </button>
      )}
      {selected && !editing && (
        <>
          <span className={styles.frame} />
          <span
            className={styles.handle}
            data-testid="resize-handle"
            onPointerDown={(event) => begin('resize', event)}
            onPointerMove={onMove}
            onPointerUp={onEnd}
            onPointerCancel={onEnd}
          />
          <button
            type="button"
            className={styles.remove}
            aria-label={`Delete ${label}`}
            onClick={() => deleteOverlay(overlay.id)}
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}

function Visual({ overlay, k }: { overlay: Overlay; k: number }) {
  switch (overlay.type) {
    case 'text':
    case 'date':
      return (
        <span
          className={[styles.text, overlay.bold ? styles.bold : ''].join(' ')}
          style={{ fontSize: overlay.size * k, lineHeight: `${lineHeight(overlay.size) * k}px` }}
        >
          {overlay.text}
        </span>
      );
    case 'check':
      return <CheckMark glyph={overlay.glyph} />;
    case 'signature':
      return <SignatureImage id={overlay.signatureId} />;
  }
}

function CheckMark({ glyph }: { glyph: 'check' | 'x' }) {
  if (glyph === 'check') {
    return (
      <svg className={styles.mark} viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden="true">
        <path d={A20_PATH} transform={glyphTransform()} fill="#000" />
      </svg>
    );
  }
  const { lines, width } = xStrokes();
  return (
    <svg className={styles.mark} viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden="true">
      {lines.map(([x1, y1, x2, y2]) => (
        <line
          key={`${x1}-${y1}`}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="#000"
          strokeWidth={width}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

/** The signature's PNG through a blob URL that is revoked when no longer shown (spec §11.7). */
function SignatureImage({ id }: { id: string }) {
  const png = useSignaturesStore((state) => state.images.get(id));
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    if (!png || !img) return;
    const url = URL.createObjectURL(png);
    img.src = url;
    return () => {
      img.removeAttribute('src');
      URL.revokeObjectURL(url);
    };
  }, [png]);
  // spec §8.3: an overlay whose signature was deleted from the library is marked.
  if (!png) return <span className={styles.missing}>Signature deleted</span>;
  return <img ref={ref} className={styles.signature} alt="" draggable={false} />;
}

/**
 * The borderless textarea for a text or date overlay (O3, spec §7.2): the same font, size and line
 * height as the overlay, so the text does not move when editing starts or ends. Enter and Escape
 * finish; Shift+Enter starts a new line.
 */
function TextEditor({
  overlay,
  k,
  label,
}: {
  overlay: Overlay & { text: string; size: number; bold: boolean };
  k: number;
  label: string;
}) {
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    finishText(overlay.id);
  };
  const lines = overlay.text.split(/\r\n|\r|\n/).length;
  return (
    <textarea
      // Focus moves here as soon as the overlay is placed or editing starts (spec §7.2).
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
      className={[styles.editor, overlay.bold ? styles.bold : ''].join(' ')}
      aria-label={label}
      value={overlay.text}
      wrap="off"
      rows={lines}
      spellCheck={false}
      style={{
        fontSize: overlay.size * k,
        lineHeight: `${lineHeight(overlay.size) * k}px`,
        // Room for the caret and the next character while typing.
        width: `calc(100% + ${overlay.size * k}px)`,
        height: lines * lineHeight(overlay.size) * k,
      }}
      onChange={(event) => setText(overlay.id, event.target.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish();
        }
      }}
    />
  );
}
