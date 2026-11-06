// Signature pixel operations on raw RGBA buffers (spec §8). No DOM: the app reads and writes
// canvas pixels and hands the buffers here.
export { NEAR_WHITE, luminance709, removeNearWhite } from './nearWhite.ts';
export { alphaBounds, cropRgba } from './bounds.ts';
