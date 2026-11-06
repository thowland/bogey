// Focus that has to wait for a page change (F6, F7). Only the current page has a field layer, so
// moving focus to a field on another page means turning the page first; the layer for the new
// page takes the request when it mounts.

import { tabbable } from './tabbing.ts';

/** A specific control, or the first or last control on the page. */
export type FocusRequest = { id: string } | 'first' | 'last';

let pending: { page: number; request: FocusRequest } | null = null;

export function requestFocus(page: number, request: FocusRequest): void {
  pending = { page, request };
}

/** The request for `page`, if any, removed so it is honored once. */
export function takeFocusRequest(page: number): FocusRequest | null {
  if (!pending || pending.page !== page) return null;
  const { request } = pending;
  pending = null;
  return request;
}

/** Focuses the requested control inside `root` and scrolls it into view. */
export function applyFocus(root: HTMLElement, request: FocusRequest): boolean {
  const controls = tabbable(root);
  const target =
    request === 'first'
      ? controls[0]
      : request === 'last'
        ? controls.at(-1)
        : root.querySelector<HTMLElement>(`#${request.id}`);
  if (!target) return false;
  target.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  target.focus({ preventScroll: true });
  return true;
}

/**
 * Shows a widget and focuses its control (F7): on the current page at once, otherwise by turning
 * to its page and leaving a request for that page's layer.
 */
export function goToWidget(
  page: number,
  id: string,
  current: number,
  setPage: (page: number) => void,
): void {
  if (page === current) {
    const layer = document.querySelector<HTMLElement>('[data-field-layer]');
    if (layer && applyFocus(layer, { id })) return;
  }
  requestFocus(page, { id });
  setPage(page);
}
