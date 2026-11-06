// Core geometry for the app (spec §5): page sizes, coordinate conversion, widget rectangles,
// nudges and snapping. Added after wave 1 so Sprints 4 and 5 share one bridge instead of each
// adding their own; extend it here rather than importing @bogey/core at run time elsewhere.
export {
  CSS_PX_PER_PT,
  pageGeometry,
  pdfRectToScreen,
  pdfToScreen,
  scaleFor,
  screenDeltaToPdf,
  screenToPdf,
  snapToGrid,
  uprightAxes,
  uprightOffset,
  viewSize,
  widgetScreenRect,
} from '@bogey/core';
