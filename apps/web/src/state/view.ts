// View state: which screen, page, zoom, tool and selection (spec §7.2, §10.4). Owned by Sprint 1;
// overlays (S4), fields (S5) and snippets (S7) use the setters defined here.
import type { Point } from '@bogey/core';
import { create } from 'zustand';
import type { Zoom } from './persistence.ts';

export type Screen = 'workspace' | 'help' | 'about' | 'privacy';
export type Tool = 'select' | 'text' | 'check' | 'date' | 'signature';
export type PanelTab = 'fields' | 'snippets' | 'signatures';

export interface ViewState {
  screen: Screen;
  /** 0-based index of the page shown. */
  page: number;
  zoom: Zoom;
  /**
   * The numeric zoom the page is shown at, with fit width and fit page resolved (spec §5.1);
   * null until a page has been measured. The page view sets it.
   */
  renderedZoom: number | null;
  tool: Tool;
  selectedOverlayId: string | null;
  /** The signature to place when `tool` is 'signature' (S3 sets it, S4 consumes it). */
  selectedSignatureId: string | null;
  /** The last point clicked on a page in select mode, for snippet placement (N2). */
  lastPoint: { page: number; point: Point } | null;
  /** The text field that snippets fill (N2), set by the field layer (S5). */
  targetField: string | null;
  panelOpen: boolean;
  panelTab: PanelTab;
}

export interface ViewActions {
  setScreen(screen: Screen): void;
  setPage(page: number): void;
  setZoom(zoom: Zoom): void;
  setRenderedZoom(zoom: number | null): void;
  setTool(tool: Tool): void;
  select(overlayId: string | null): void;
  chooseSignature(signatureId: string | null): void;
  setLastPoint(lastPoint: ViewState['lastPoint']): void;
  setTargetField(name: string | null): void;
  setPanel(open: boolean, tab?: PanelTab): void;
  reset(): void;
}

const initial: ViewState = {
  screen: 'workspace',
  page: 0,
  zoom: 'fit-width',
  renderedZoom: null,
  tool: 'select',
  selectedOverlayId: null,
  selectedSignatureId: null,
  lastPoint: null,
  targetField: null,
  panelOpen: true,
  panelTab: 'fields',
};

export const useViewStore = create<ViewState & ViewActions>()((set) => ({
  ...initial,
  setScreen: (screen) => set({ screen }),
  setPage: (page) => set({ page: Math.max(0, page) }),
  setZoom: (zoom) => set({ zoom }),
  setRenderedZoom: (renderedZoom) => set({ renderedZoom }),
  setTool: (tool) => set({ tool, selectedOverlayId: null }),
  select: (selectedOverlayId) => set({ selectedOverlayId }),
  chooseSignature: (selectedSignatureId) =>
    set({ selectedSignatureId, tool: selectedSignatureId ? 'signature' : 'select' }),
  setLastPoint: (lastPoint) => set({ lastPoint }),
  setTargetField: (targetField) => set({ targetField }),
  setPanel: (panelOpen, tab) => set((state) => ({ panelOpen, panelTab: tab ?? state.panelTab })),
  reset: () => set(initial),
}));
