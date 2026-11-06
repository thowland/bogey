// Zoom (V3, spec §5.1, §10.4). Zoom 1 is 100%, physical size. Fit width and fit page are resolved
// to a number from the space available and the page's size at 100%.
import type { Zoom } from '../../state/persistence.ts';

export const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3] as const;
export const MIN_ZOOM = ZOOM_PRESETS[0];
export const MAX_ZOOM = ZOOM_PRESETS[ZOOM_PRESETS.length - 1]!;
/** A fitted page in a very small window may go below 50%, but not to nothing. */
const MIN_FITTED_ZOOM = 0.1;

/** Space left around the page inside the page area, in CSS px on each side. */
export const PAGE_GUTTER = 16;

export interface Size {
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The numeric zoom for a setting, given the page's size at 100% and the page area's size. */
export function resolveZoom(zoom: Zoom, page: Size, area: Size): number {
  if (typeof zoom === 'number') return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const width = (area.width - 2 * PAGE_GUTTER) / page.width;
  if (zoom === 'fit-width') return clamp(width, MIN_FITTED_ZOOM, MAX_ZOOM);
  const height = (area.height - 2 * PAGE_GUTTER) / page.height;
  return clamp(Math.min(width, height), MIN_FITTED_ZOOM, MAX_ZOOM);
}

/** The next preset above (`+1`) or below (`-1`) the zoom currently shown. */
export function stepZoom(current: number, direction: 1 | -1): number {
  const epsilon = 1e-6;
  if (direction > 0) return ZOOM_PRESETS.find((preset) => preset > current + epsilon) ?? MAX_ZOOM;
  return [...ZOOM_PRESETS].reverse().find((preset) => preset < current - epsilon) ?? MIN_ZOOM;
}

export function zoomLabel(zoom: Zoom): string {
  if (zoom === 'fit-width') return 'Fit width';
  if (zoom === 'fit-page') return 'Fit page';
  return `${Math.round(zoom * 100)}%`;
}

/** The values the zoom menu offers, in order. */
export const ZOOM_CHOICES: readonly Zoom[] = ['fit-width', 'fit-page', ...ZOOM_PRESETS];

/** A stable key for a setting: `fit-width`, `fit-page`, or the percentage as a string. */
export const zoomValue = (zoom: Zoom): string =>
  typeof zoom === 'number' ? String(Math.round(zoom * 100)) : zoom;
