// The overlay layer, tools and history in the page (O1–O9, N2, U2, spec §7.2–§7.4, §13).
import type { Overlay, PageGeometry, PdfInfo, Rotation } from '@bogey/core';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pdfToScreen } from '../src/core-bridge/geometry.ts';
import { OverlayLayer, ToolButtons, UndoRedo } from '../src/features/overlays/index.ts';
import { chooseTool, finishText, placeAt, setText } from '../src/features/overlays/actions.ts';
import { clearDocumentEdits } from '../src/features/overlays/documentReset.ts';
import { overlayRect } from '../src/features/overlays/model.ts';
import { useOverlayUi } from '../src/features/overlays/overlayUi.ts';
import { useDocumentStore } from '../src/state/document.ts';
import { useEditsStore } from '../src/state/edits.ts';
import { useSettingsStore } from '../src/state/settings.ts';
import { useSignaturesStore } from '../src/state/signatures.ts';
import { useViewStore } from '../src/state/view.ts';

const K = 96 / 72;

const geometry = (index: number, rotate: Rotation = 0): PageGeometry => ({
  index,
  view: [0, 0, 612, 792],
  rotate,
  userUnit: 1,
});

function openDoc(rotate: Rotation = 0) {
  const info: PdfInfo = {
    formType: 'flat',
    xfa: 'none',
    encrypted: false,
    decryptable: true,
    pageCount: 2,
    pages: [geometry(0, rotate), geometry(1, rotate)],
    fields: [],
    initialValues: {},
    metadata: {},
  };
  useDocumentStore
    .getState()
    .update({ status: 'ready', name: 'a.pdf', info, bytes: new Uint8Array([1]) });
  useViewStore.getState().setRenderedZoom(1);
}

function Page() {
  return (
    <>
      <ToolButtons />
      <UndoRedo />
      <div data-testid="sheet">
        <input aria-label="A field" />
        <OverlayLayer />
      </div>
    </>
  );
}

const overlays = () => useEditsStore.getState().present.overlays;
const layer = () => screen.getByTestId('overlay-layer');

/** A tap on the layer at page-local CSS px (jsdom rects are all zero). */
function tap(x: number, y: number) {
  fireEvent.pointerDown(layer(), { clientX: x, clientY: y, button: 0, pointerId: 1 });
  fireEvent.pointerUp(layer(), { clientX: x, clientY: y, button: 0, pointerId: 1 });
}

const addSignature = () =>
  useSignaturesStore
    .getState()
    .setAll(
      [{ id: 'lib', name: 'Tim', kind: 'signature', width: 300, height: 100, createdAt: 1 }],
      new Map([['lib', new Blob([new Uint8Array([1])], { type: 'image/png' })]]),
    );

beforeEach(() => openDoc());
afterEach(() => useOverlayUi.getState().reset());

describe('tools', () => {
  it('shows the tools, pressed for the current one, and disabled without a document', async () => {
    useDocumentStore.getState().reset();
    const { rerender } = render(<Page />);
    expect(screen.getByRole('button', { name: 'Text' })).toBeDisabled();
    openDoc();
    rerender(<Page />);
    await userEvent.click(screen.getByRole('button', { name: 'Text' }));
    expect(screen.getByRole('button', { name: 'Text' })).toHaveAttribute('aria-pressed', 'true');
    expect(useViewStore.getState().tool).toBe('text');
    expect(screen.getByText(/Text tool: click the page/)).toBeInTheDocument();
  });

  it('chooses tools from the keyboard, and Escape returns to select', async () => {
    render(<Page />);
    const user = userEvent.setup();
    for (const [key, tool] of [
      ['t', 'text'],
      ['c', 'check'],
      ['d', 'date'],
      ['v', 'select'],
    ] as const) {
      await user.keyboard(key);
      expect(useViewStore.getState().tool).toBe(tool);
    }
    await user.keyboard('t');
    await user.keyboard('{Escape}');
    expect(useViewStore.getState().tool).toBe('select');
    // Not while typing in a field.
    await user.click(screen.getByLabelText('A field'));
    await user.keyboard('t');
    expect(useViewStore.getState().tool).toBe('select');
  });

  it('opens the Signatures panel when S is pressed with no signature chosen', async () => {
    render(<Page />);
    useViewStore.getState().setPanel(false);
    await userEvent.keyboard('s');
    expect(useViewStore.getState()).toMatchObject({
      tool: 'select',
      panelOpen: true,
      panelTab: 'signatures',
    });
    addSignature();
    useViewStore.getState().chooseSignature('lib');
    useViewStore.getState().setTool('select');
    await userEvent.keyboard('s');
    expect(useViewStore.getState()).toMatchObject({
      tool: 'signature',
      selectedSignatureId: 'lib',
    });
  });

  it('ignores shortcuts on other screens and without a document', async () => {
    render(<Page />);
    useViewStore.getState().setScreen('help');
    await userEvent.keyboard('t');
    expect(useViewStore.getState().tool).toBe('select');
  });
});

describe('placement', () => {
  it('lets clicks through to fields in select mode and takes them in a placement tool', () => {
    render(<Page />);
    expect(layer().className).not.toMatch(/placing/);
    act(() => chooseTool('check'));
    expect(layer().className).toMatch(/placing/);
  });

  it('places a check centred on the tap and returns to select', () => {
    render(<Page />);
    act(() => chooseTool('check'));
    tap(200, 300);
    expect(overlays()).toHaveLength(1);
    const [o] = overlays();
    expect(o).toMatchObject({ type: 'check', glyph: 'check', size: 12, page: 0 });
    const r = overlayRect(geometry(0), o!, 1);
    expect(Math.abs(r.left + r.width / 2 - 200)).toBeLessThan(K);
    expect(useViewStore.getState()).toMatchObject({ tool: 'select', selectedOverlayId: o!.id });
    expect(screen.getByRole('button', { name: 'Check mark overlay, page 1' })).toBeInTheDocument();
  });

  it('does not place on a drag (a pan)', () => {
    render(<Page />);
    act(() => chooseTool('check'));
    fireEvent.pointerDown(layer(), { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
    fireEvent.pointerUp(layer(), { clientX: 60, clientY: 10, button: 0, pointerId: 1 });
    fireEvent.pointerDown(layer(), { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
    fireEvent.pointerCancel(layer(), { pointerId: 1 });
    fireEvent.pointerUp(layer(), { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
    expect(overlays()).toHaveLength(0);
  });

  it('places a date with today in the chosen format', () => {
    useSettingsStore.getState().update({ dateFormat: 'YYYY-MM-DD' });
    render(<Page />);
    act(() => chooseTool('date'));
    tap(100, 100);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(overlays()[0]).toMatchObject({
      type: 'date',
      text: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    });
  });

  it('places a signature 150 pt wide from the library, and asks for one when it is gone', () => {
    addSignature();
    render(<Page />);
    act(() => useViewStore.getState().chooseSignature('lib'));
    tap(300, 300);
    expect(overlays()[0]).toMatchObject({
      type: 'signature',
      width: 150,
      height: 50,
      signatureId: 'lib',
    });
    expect(
      screen.getByRole('button', { name: 'Signature overlay: Tim, page 1' }),
    ).toBeInTheDocument();
    // Placing again after the signature was deleted from the library.
    act(() => {
      useViewStore.getState().setTool('signature');
      useSignaturesStore.getState().setAll([], new Map());
    });
    tap(300, 300);
    expect(overlays()).toHaveLength(1);
    expect(useViewStore.getState().panelTab).toBe('signatures');
    expect(screen.getByText('Signature deleted')).toBeInTheDocument();
  });

  it('does nothing without a page or in select mode', () => {
    render(<Page />);
    act(() => placeAt({ x: 1, y: 1 }, 1));
    expect(overlays()).toHaveLength(0);
    useDocumentStore.getState().reset();
    act(() => useViewStore.getState().setTool('check'));
    act(() => placeAt({ x: 1, y: 1 }, 1));
    expect(overlays()).toHaveLength(0);
  });

  it('shows only the current page’s overlays', () => {
    useEditsStore.getState().edit({
      type: 'addOverlay',
      overlay: { id: 'p2', type: 'check', page: 1, x: 1, y: 1, glyph: 'x', size: 10 },
    });
    render(<Page />);
    expect(screen.queryByRole('button', { name: /X mark overlay/ })).toBeNull();
    act(() => useViewStore.getState().setPage(1));
    expect(screen.getByRole('button', { name: 'X mark overlay, page 2' })).toBeInTheDocument();
  });
});

describe('text overlays', () => {
  it('opens for typing, joins the document with its first character, and Enter finishes', async () => {
    render(<Page />);
    act(() => chooseTool('text'));
    tap(100, 200);
    const editor = screen.getByRole('textbox', { name: /Text overlay/ });
    expect(editor).toHaveFocus();
    expect(overlays()).toHaveLength(0);
    const user = userEvent.setup();
    await user.keyboard('John');
    expect(overlays()[0]).toMatchObject({ type: 'text', text: 'John', size: 10 });
    await user.keyboard('{Shift>}{Enter}{/Shift}Smith{Enter}');
    expect(overlays()[0]).toMatchObject({ text: 'John\nSmith' });
    const body = screen.getByRole('button', { name: 'Text overlay: John Smith, page 1' });
    expect(body).toHaveFocus();
    // Placement, typing and the line break are one undo step.
    act(() => useEditsStore.getState().undo());
    expect(overlays()).toHaveLength(0);
  });

  it('leaves nothing behind when no text was typed, and removes text emptied later', async () => {
    render(<Page />);
    act(() => chooseTool('text'));
    tap(100, 200);
    await userEvent.keyboard('{Escape}');
    expect(overlays()).toHaveLength(0);
    expect(useViewStore.getState().selectedOverlayId).toBeNull();

    act(() => chooseTool('text'));
    tap(100, 200);
    await userEvent.keyboard('Hi');
    const id = overlays()[0]!.id;
    act(() => setText(id, ''));
    act(() => finishText(id));
    expect(overlays()).toHaveLength(0);
  });

  it('edits again on double-click or Enter, and finishes on blur', async () => {
    useEditsStore.getState().edit({
      type: 'addOverlay',
      overlay: {
        id: 'd',
        type: 'date',
        page: 0,
        x: 72,
        y: 700,
        text: '1/1/2026',
        size: 12,
        bold: false,
      },
    });
    render(<Page />);
    const user = userEvent.setup();
    await user.dblClick(screen.getByRole('button', { name: /Date overlay/ }));
    const editor = screen.getByRole('textbox', { name: /Date overlay/ });
    await user.clear(editor);
    await user.type(editor, '2/2/2026');
    await user.click(screen.getByLabelText('A field'));
    expect(overlays()[0]).toMatchObject({ text: '2/2/2026' });
    expect(screen.queryByRole('textbox', { name: /Date overlay/ })).toBeNull();
    screen.getByRole('button', { name: /Date overlay/ }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: /Date overlay/ })).toHaveFocus();
  });

  it('changes size and bold from the toolbar', async () => {
    useEditsStore.getState().edit({
      type: 'addOverlay',
      overlay: { id: 't', type: 'text', page: 0, x: 72, y: 700, text: 'Hi', size: 10, bold: false },
    });
    useViewStore.getState().select('t');
    render(<Page />);
    const user = userEvent.setup();
    const props = screen.getByRole('group', { name: 'Selected overlay' });
    await user.selectOptions(within(props).getByRole('combobox', { name: 'Size' }), '24');
    expect(overlays()[0]).toMatchObject({ size: 24 });
    await user.click(within(props).getByRole('button', { name: 'Bold' }));
    expect(overlays()[0]).toMatchObject({ bold: true });
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('selection and manipulation', () => {
  const add = (overlay: Overlay) => useEditsStore.getState().edit({ type: 'addOverlay', overlay });
  const check: Overlay = {
    id: 'c',
    type: 'check',
    page: 0,
    x: 100,
    y: 600,
    glyph: 'check',
    size: 12,
  };

  it('selects on press and drags in one undo step, snapped', () => {
    add(check);
    render(<Page />);
    const body = screen.getByRole('button', { name: /Check mark overlay/ });
    fireEvent.pointerDown(body, { clientX: 0, clientY: 0, button: 0, pointerId: 2 });
    expect(useViewStore.getState().selectedOverlayId).toBe('c');
    fireEvent.pointerMove(body, { clientX: 1, clientY: 0, pointerId: 2 });
    fireEvent.pointerMove(body, { clientX: 40 * K, clientY: 0, pointerId: 2 });
    fireEvent.pointerMove(body, { clientX: 20 * K, clientY: 10 * K, pointerId: 3 });
    fireEvent.pointerMove(body, { clientX: 20 * K, clientY: 10 * K, pointerId: 2 });
    // Nothing is committed until the pointer comes up.
    expect(overlays()[0]).toMatchObject({ x: 100, y: 600 });
    fireEvent.pointerUp(body, { clientX: 20 * K, clientY: 10 * K, pointerId: 2 });
    expect(overlays()[0]).toMatchObject({ x: 120, y: 590 });
    act(() => useEditsStore.getState().undo());
    expect(overlays()[0]).toMatchObject({ x: 100, y: 600 });
  });

  it('only selects on a press without movement, and ignores other buttons', () => {
    add(check);
    render(<Page />);
    const body = screen.getByRole('button', { name: /Check mark overlay/ });
    fireEvent.pointerDown(body, { clientX: 0, clientY: 0, button: 2, pointerId: 2 });
    expect(useViewStore.getState().selectedOverlayId).toBeNull();
    fireEvent.pointerDown(body, { clientX: 0, clientY: 0, button: 0, pointerId: 2 });
    fireEvent.pointerUp(body, { clientX: 0, clientY: 0, pointerId: 2 });
    expect(useEditsStore.getState().canUndo).toBe(true); // the add only
    act(() => useEditsStore.getState().undo());
    expect(overlays()).toHaveLength(0);
  });

  it('resizes from the handle, and a cancelled drag changes nothing', () => {
    add(check);
    useViewStore.getState().select('c');
    render(<Page />);
    const handle = screen.getByTestId('resize-handle');
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, button: 0, pointerId: 4 });
    fireEvent.pointerMove(handle, { clientX: 12 * K, clientY: 12 * K, pointerId: 4 });
    fireEvent.pointerUp(handle, { clientX: 12 * K, clientY: 12 * K, pointerId: 4 });
    expect(overlays()[0]).toMatchObject({ size: 24 });
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, button: 0, pointerId: 4 });
    fireEvent.pointerMove(handle, { clientX: -50, clientY: -50, pointerId: 4 });
    fireEvent.pointerCancel(handle, { pointerId: 4 });
    expect(overlays()[0]).toMatchObject({ size: 24 });
  });

  it('nudges with arrow keys in screen directions on a rotated page, coalesced', async () => {
    openDoc(90);
    add(check);
    render(<Page />);
    const body = screen.getByRole('button', { name: /Check mark overlay/ });
    body.focus();
    const before = pdfToScreen(geometry(0, 90), check, 1);
    await userEvent.keyboard('{ArrowRight}{Shift>}{ArrowDown}{/Shift}');
    const after = pdfToScreen(geometry(0, 90), overlays()[0]!, 1);
    expect(after.x - before.x).toBeCloseTo(K);
    expect(after.y - before.y).toBeCloseTo(10 * K);
    act(() => useEditsStore.getState().undo());
    expect(overlays()[0]).toMatchObject({ x: 100, y: 600 });
  });

  it('deletes with Delete, Backspace or the frame button, and undo restores', async () => {
    add(check);
    add({ ...check, id: 'c2', x: 300 });
    render(<Page />);
    const user = userEvent.setup();
    const [first] = screen.getAllByRole('button', { name: /Check mark overlay/ });
    await user.click(first!);
    await user.keyboard('{Delete}');
    expect(overlays().map((o) => o.id)).toEqual(['c2']);
    await user.keyboard('{Backspace}'); // nothing selected
    expect(overlays()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /Check mark overlay/ }));
    await user.click(screen.getByRole('button', { name: 'Delete Check mark overlay, page 1' }));
    expect(overlays()).toHaveLength(0);
    await user.keyboard('{Meta>}z{/Meta}');
    expect(overlays()).toHaveLength(1);
    expect(screen.getByText('Undone')).toBeInTheDocument();
  });

  it('changes a check’s mark and size, and remembers the mark for the next one', async () => {
    add(check);
    useViewStore.getState().select('c');
    render(<Page />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '✗ X' }));
    expect(overlays()[0]).toMatchObject({ glyph: 'x' });
    expect(useOverlayUi.getState().glyph).toBe('x');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Size' }), '20');
    expect(overlays()[0]).toMatchObject({ size: 20 });
  });

  it('offers no size for signatures', () => {
    addSignature();
    add({
      id: 's',
      type: 'signature',
      page: 0,
      x: 1,
      y: 1,
      width: 150,
      height: 50,
      signatureId: 'lib',
    });
    useViewStore.getState().select('s');
    render(<Page />);
    expect(screen.queryByRole('group', { name: 'Selected overlay' })).toBeNull();
  });
});

describe('the last point and selection on the page', () => {
  it('records lastPoint on any press in select mode and clears the selection off overlays', () => {
    useEditsStore.getState().edit({
      type: 'addOverlay',
      overlay: { id: 'c', type: 'check', page: 0, x: 1, y: 1, glyph: 'x', size: 10 },
    });
    useViewStore.getState().select('c');
    render(<Page />);
    fireEvent.pointerDown(screen.getByLabelText('A field'), { clientX: 72 * K, clientY: 72 * K });
    expect(useViewStore.getState().lastPoint).toEqual({ page: 0, point: { x: 72, y: 720 } });
    expect(useViewStore.getState().selectedOverlayId).toBeNull();
    // A press on an overlay records the point too, and keeps it selected.
    fireEvent.pointerDown(screen.getByRole('button', { name: /X mark/ }), {
      clientX: 0,
      clientY: 0,
      button: 0,
    });
    expect(useViewStore.getState().selectedOverlayId).toBe('c');
    // Not in a placement tool.
    act(() => chooseTool('check'));
    fireEvent.pointerDown(screen.getByTestId('sheet'), { clientX: 0, clientY: 0 });
    expect(useViewStore.getState().lastPoint).toEqual({ page: 0, point: { x: 0, y: 792 } });
  });
});

describe('undo and redo', () => {
  it('undoes and redoes every edit kind from the buttons and keys', async () => {
    render(<Page />);
    const user = userEvent.setup();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    const edit = useEditsStore.getState().edit;
    act(() => {
      edit({
        type: 'addOverlay',
        overlay: { id: 'a', type: 'text', page: 0, x: 1, y: 1, text: 'a', size: 10, bold: false },
      });
      edit({ type: 'updateOverlay', id: 'a', patch: { text: 'b' } });
      edit({ type: 'moveOverlay', id: 'a', x: 5, y: 5 });
      edit({ type: 'updateOverlay', id: 'a', patch: { size: 20 } });
      edit({ type: 'deleteOverlay', id: 'a' });
    });
    const states = [
      [],
      [{ text: 'b', x: 5, size: 20 }],
      [{ text: 'b', x: 5, size: 10 }],
      [{ text: 'b', x: 1 }],
      [{ text: 'a' }],
      [],
    ];
    for (const expected of states.slice(1)) {
      await user.click(screen.getByRole('button', { name: 'Undo' }));
      expect(overlays()).toMatchObject(expected);
    }
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(overlays()).toMatchObject([{ text: 'a' }]);
    await user.keyboard('{Control>}y{/Control}');
    expect(overlays()).toMatchObject([{ text: 'b' }]);
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(overlays()).toMatchObject([{ x: 5 }]);
    expect(screen.getByText('Redone')).toBeInTheDocument();
  });

  it('leaves Cmd+Z to the browser inside a text control', async () => {
    useEditsStore.getState().edit({
      type: 'addOverlay',
      overlay: { id: 'c', type: 'check', page: 0, x: 1, y: 1, glyph: 'x', size: 10 },
    });
    render(<Page />);
    await userEvent.click(screen.getByLabelText('A field'));
    await userEvent.keyboard('{Meta>}z{/Meta}');
    expect(overlays()).toHaveLength(1);
  });
});

describe('document changes', () => {
  it('clears overlays, selection and editing when another document opens', () => {
    useEditsStore.getState().edit({
      type: 'addOverlay',
      overlay: { id: 'c', type: 'check', page: 0, x: 1, y: 1, glyph: 'x', size: 10 },
    });
    useViewStore.getState().select('c');
    useOverlayUi.getState().setEditing('c');
    useDocumentStore.getState().update({ status: 'opening' });
    expect(overlays()).toHaveLength(0);
    expect(useViewStore.getState().selectedOverlayId).toBeNull();
    expect(useOverlayUi.getState().editingId).toBeNull();
    clearDocumentEdits();
  });

  it('renders nothing before the page is measured', () => {
    useViewStore.getState().setRenderedZoom(null);
    render(<Page />);
    expect(screen.queryByTestId('overlay-layer')).toBeNull();
  });
});

describe('announcements', () => {
  it('repeats a repeated message so it is read again', () => {
    const { announce } = useOverlayUi.getState();
    announce('Undone');
    announce('Undone');
    expect(useOverlayUi.getState().announcement).toBe('Undone ');
  });
});
