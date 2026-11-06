// Shared helpers for the signature tests (Sprint 3).
import { openRepository, type Repository } from '../src/state/persistence.ts';
import { useStorageStore } from '../src/state/storage.ts';

export interface PointerInit {
  pointerId?: number;
  pointerType?: string;
  x: number;
  y: number;
  pressure?: number;
  buttons?: number;
  button?: number;
}

/** Dispatches a real PointerEvent on `target`, as a browser would. */
export function pointer(
  target: Element,
  type: string,
  init: PointerInit,
  coalesced?: PointerEvent[],
) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: init.pointerId ?? 1,
    pointerType: init.pointerType ?? 'pen',
    clientX: init.x,
    clientY: init.y,
    pressure: init.pressure ?? 0.5,
    buttons: init.buttons ?? (type === 'pointerup' ? 0 : 1),
    button: init.button ?? (type === 'pointermove' ? -1 : 0),
  });
  if (coalesced) Object.defineProperty(event, 'getCoalescedEvents', { value: () => coalesced });
  target.dispatchEvent(event);
  return event;
}

/** A pen stroke along `points`, pressure rising from 0.2 to 1. */
export function penStroke(target: Element, points: readonly [number, number][], pointerId = 1) {
  const pressure = (i: number) => 0.2 + (0.8 * i) / Math.max(1, points.length - 1);
  const [first, ...rest] = points;
  pointer(target, 'pointerdown', { pointerId, x: first![0], y: first![1], pressure: pressure(0) });
  rest.forEach(([x, y], i) =>
    pointer(target, 'pointermove', { pointerId, x, y, pressure: pressure(i + 1) }),
  );
  const last = points.at(-1)!;
  pointer(target, 'pointerup', { pointerId, x: last[0], y: last[1], pressure: 0 });
}

/** A memory-mode repository attached as the app's storage. */
export async function attachMemoryRepository(): Promise<Repository> {
  const repository = await openRepository({ factory: null });
  useStorageStore.getState().attach(repository);
  return repository;
}
