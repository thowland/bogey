// The draw dialog and its canvas in jsdom with synthetic pointer events (spec §8.1, G2, G3).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DrawDialog } from '../src/features/signatures/DrawDialog.tsx';
import * as pixels from '../src/features/signatures/pixels.ts';
import { SignaturePadModel } from '../src/features/signatures/padModel.ts';
import { SignaturePad, type SignaturePadHandle } from '../src/features/signatures/SignaturePad.tsx';
import { useSignaturesStore } from '../src/state/signatures.ts';
import { attachMemoryRepository, penStroke, pointer } from './signatures-helpers.ts';

const canvas = () => screen.getByRole('img', { name: 'Signature drawing area' });

describe('SignaturePad', () => {
  it('records pen pressure, uses coalesced events and reports finished strokes', () => {
    const model = new SignaturePadModel();
    const onChange = vi.fn();
    const handle = { current: null as SignaturePadHandle | null };
    render(
      <SignaturePad
        model={model}
        label="Signature drawing area"
        onChange={onChange}
        handle={handle}
      />,
    );
    const target = canvas();
    pointer(target, 'pointerdown', { x: 10, y: 10, pressure: 0.2 });
    const coalesced = [0.4, 0.6, 0.8].map(
      (pressure, i) =>
        new PointerEvent('pointermove', {
          pointerId: 1,
          pointerType: 'pen',
          clientX: 20 + i * 10,
          clientY: 10,
          pressure,
          buttons: 1,
        }),
    );
    pointer(target, 'pointermove', { x: 40, y: 10, pressure: 0.8 }, coalesced);
    // Hover after lifting the pen, and touches during the stroke, add nothing.
    pointer(target, 'pointerdown', { pointerId: 5, pointerType: 'touch', x: 300, y: 100 });
    pointer(target, 'pointermove', { x: 50, y: 10, buttons: 0, pressure: 0 });
    expect(onChange).not.toHaveBeenCalled();
    pointer(target, 'pointerup', { x: 40, y: 10 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(model.strokes).toHaveLength(1);
    // PointerEvent pressure is single precision.
    const widths = model.strokes[0]!.points.map((p) => p.width);
    [2, 2.5, 3, 3.5].forEach((width, i) => expect(widths[i]).toBeCloseTo(width, 5));
    expect(handle.current!.scale).toBe(1);
    expect(handle.current!.read()).toMatchObject({ width: 600, height: 200 });
    act(() => handle.current!.clear());
    expect(model.isEmpty).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('ignores moves when nothing is being drawn and a pointerup from another pointer', () => {
    const model = new SignaturePadModel();
    render(<SignaturePad model={model} label="Signature drawing area" />);
    pointer(canvas(), 'pointermove', { x: 5, y: 5 });
    pointer(canvas(), 'pointerdown', { x: 5, y: 5, pointerType: 'mouse', button: 2 });
    pointer(canvas(), 'pointerdown', { x: 5, y: 5 });
    pointer(canvas(), 'pointerup', { pointerId: 4, x: 5, y: 5 });
    expect(model.drawing).toBe(true);
    pointer(canvas(), 'pointercancel', { x: 5, y: 5 });
    expect(model.drawing).toBe(false);
  });
});

describe('DrawDialog', () => {
  it('saves a trimmed transparent PNG to the library and the repository', async () => {
    const repository = await attachMemoryRepository();
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<DrawDialog open onClose={onClose} onSaved={onSaved} />);
    expect(screen.getByText(/upload an image of your signature instead/)).toBeInTheDocument();
    penStroke(canvas(), [
      [100, 50],
      [150, 80],
      [200, 60],
    ]);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [item] = useSignaturesStore.getState().items;
    expect(item).toMatchObject({ name: 'Signature', kind: 'signature' });
    expect(onSaved).toHaveBeenCalledWith(item);
    // Trimmed to the ink plus 8 px each side (devicePixelRatio is 1 in jsdom).
    expect(item!.width).toBeGreaterThanOrEqual(100 + 16);
    expect(item!.width).toBeLessThan(100 + 16 + 8);
    // Midpoint smoothing rounds off the corner at y = 80, so the ink is less than 30 px tall.
    expect(item!.height).toBeGreaterThanOrEqual(20 + 16);
    expect(item!.height).toBeLessThan(30 + 16 + 8);
    expect(useSignaturesStore.getState().images.get(item!.id)!.type).toBe('image/png');
    const record = await repository.get('signatures', item!.id);
    expect(record!.png).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(record!.png).slice(1, 4)).toEqual(new Uint8Array([80, 78, 71])); // "PNG"
  });

  it('refuses to save an empty canvas, and clears', async () => {
    const user = userEvent.setup();
    render(<DrawDialog open onClose={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('There is nothing to save yet');
    act(() =>
      penStroke(canvas(), [
        [10, 10],
        [20, 20],
      ]),
    );
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('There is nothing to save yet');
    expect(useSignaturesStore.getState().items).toEqual([]);
  });

  it('names initials by kind until the user types a name', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DrawDialog open onClose={onClose} />);
    const name = screen.getByRole('textbox', { name: 'Name' });
    await user.click(screen.getByRole('radio', { name: 'Initials' }));
    expect(name).toHaveValue('Initials');
    await user.clear(name);
    await user.type(name, '  TH ');
    await user.click(screen.getByRole('radio', { name: 'Signature' }));
    expect(name).toHaveValue('  TH ');
    await user.click(screen.getByRole('radio', { name: 'Initials' }));
    penStroke(canvas(), [
      [10, 10],
      [30, 30],
    ]);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useSignaturesStore.getState().items[0]).toMatchObject({ name: 'TH', kind: 'initials' });
  });

  it('reports a failed save without closing, and cancels', async () => {
    const spy = vi.spyOn(pixels, 'trimAndEncode');
    spy.mockRejectedValueOnce(new Error('toBlob failed')).mockResolvedValueOnce(null);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onClose = vi.fn();
    render(<DrawDialog open onClose={onClose} />);
    penStroke(canvas(), [
      [10, 10],
      [30, 30],
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('There is nothing to save yet'),
    );
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    spy.mockRestore();
    error.mockRestore();
  });
});
