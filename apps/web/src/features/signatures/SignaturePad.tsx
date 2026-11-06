// The drawing surface (spec §8.1, G2). Pointer Events only, with `touch-action: none` in CSS;
// the stroke shape and which events count are decided by SignaturePadModel, and this component
// only converts events and draws what the model returns.
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import type { PadUpdate, PointerSample, SignaturePadModel } from './padModel.ts';
import { readCanvas, type Pixels } from './pixels.ts';
import { drawSegments } from './render.ts';
import styles from './Signatures.module.css';

export interface SignaturePadHandle {
  /** Erases everything drawn. */
  clear(): void;
  /** The canvas pixels at device resolution. */
  read(): Pixels;
  /** Device pixels per CSS px of the backing store. */
  readonly scale: number;
}

export interface SignaturePadProps {
  model: SignaturePadModel;
  /** Called when a stroke ends or the pad is cleared. */
  onChange?(): void;
  label: string;
  describedBy?: string;
  handle?: Ref<SignaturePadHandle>;
}

/** CSS size used when layout reports none (a hidden dialog, or jsdom). */
const FALLBACK = { width: 600, height: 200 };

export function SignaturePad({ model, onChange, label, describedBy, handle }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scaleRef = useRef(1);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useImperativeHandle(
    handle,
    () => ({
      clear() {
        model.clear();
        const canvas = canvasRef.current;
        canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
        onChangeRef.current?.();
      },
      read: () => readCanvas(canvasRef.current!),
      get scale() {
        return scaleRef.current;
      },
    }),
    [model],
  );

  useEffect(() => {
    const canvas = canvasRef.current!;
    let rect = canvas.getBoundingClientRect();

    const context = () => {
      const ctx = canvas.getContext('2d');
      ctx?.setTransform(scaleRef.current, 0, 0, scaleRef.current, 0, 0);
      return ctx;
    };

    const apply = (update: PadUpdate | null) => {
      if (!update) return;
      const ctx = context();
      if (!ctx) return;
      if ('redraw' in update) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawSegments(ctx, update.redraw);
      } else {
        drawSegments(ctx, update.draw);
      }
    };

    // Backing store at devicePixelRatio; resizing clears a canvas, so redraw from the model.
    const size = () => {
      rect = canvas.getBoundingClientRect();
      const width = rect.width || FALLBACK.width;
      const height = rect.height || FALLBACK.height;
      const scale = window.devicePixelRatio || 1;
      const w = Math.round(width * scale);
      const h = Math.round(height * scale);
      if (canvas.width === w && canvas.height === h && scaleRef.current === scale) return;
      scaleRef.current = scale;
      canvas.width = w;
      canvas.height = h;
      apply({ redraw: model.allSegments() });
    };
    size();

    const sample = (event: PointerEvent): PointerSample => ({
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      pressure: event.pressure,
      buttons: event.buttons,
      button: event.button,
    });

    const down = (event: PointerEvent) => {
      rect = canvas.getBoundingClientRect();
      const update = model.down(sample(event));
      if (!update) return;
      event.preventDefault();
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic events, or a pointer that already went away: drawing works without capture.
      }
      apply(update);
    };

    const move = (event: PointerEvent) => {
      if (!model.drawing) return;
      // Coalesced events carry every sample since the last frame (240 Hz for the Pencil).
      const coalesced =
        typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
      const events = coalesced.length > 0 ? coalesced : [event];
      apply(model.move(events.map(sample)));
    };

    const up = (event: PointerEvent) => {
      const update = model.up(event);
      if (!update) return;
      apply(update);
      onChangeRef.current?.();
    };

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(size) : null;
    observer?.observe(canvas);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      observer?.disconnect();
    };
  }, [model]);

  return (
    <canvas
      ref={canvasRef}
      className={styles.pad}
      role="img"
      aria-label={label}
      aria-describedby={describedBy}
    />
  );
}
