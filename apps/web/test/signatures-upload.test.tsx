// The upload dialog in jsdom (spec §8.2, G4). Decoding is replaced here because jsdom has no
// image decoder; signatures.browser.test.tsx decodes real PNG and JPEG files.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import * as pixels from '../src/features/signatures/pixels.ts';
import { NOTHING_LEFT, UploadDialog } from '../src/features/signatures/UploadDialog.tsx';
import { useSignaturesStore } from '../src/state/signatures.ts';
import { attachMemoryRepository } from './signatures-helpers.ts';

/** 40 × 20 white with a mid-grey (luminance 200) block and a black block. */
function sample(): pixels.Pixels {
  const width = 40;
  const height = 20;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 5; y < 10; y += 1) {
    for (let x = 10; x < 15; x += 1) data.set([200, 200, 200, 255], (y * width + x) * 4);
    for (let x = 15; x < 20; x += 1) data.set([0, 0, 0, 255], (y * width + x) * 4);
  }
  return { data, width, height };
}

const decoded = { ok: true as const, value: { full: sample(), preview: sample() } };
const file = new File(['x'], 'signature.jpg', { type: 'image/jpeg' });

describe('UploadDialog', () => {
  let decode: MockInstance<typeof pixels.decodeUpload>;
  beforeEach(() => {
    decode = vi.spyOn(pixels, 'decodeUpload');
    return () => decode.mockRestore();
  });

  it('previews, applies the threshold and saves a trimmed PNG', async () => {
    const repository = await attachMemoryRepository();
    decode.mockResolvedValue(decoded);
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<UploadDialog open onClose={onClose} />);
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.upload(screen.getByLabelText('Image file'), file);
    expect(decode).toHaveBeenCalledWith(file);
    const preview = await screen.findByRole('img', { name: /Preview/ });
    expect(preview).toHaveProperty('width', 40);
    const slider = screen.getByRole('slider', { name: /Background cutoff: 235/ });
    expect(slider).toHaveAttribute('min', '180');
    expect(slider).toHaveAttribute('max', '250');
    // At 235 the grey block stays; at 190 it goes, and only the black block is left.
    fireEvent.change(slider, { target: { value: '190' } });
    expect(screen.getByRole('slider', { name: /Background cutoff: 190/ })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Initials' }));
    await user.click(save);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [item] = useSignaturesStore.getState().items;
    expect(item).toMatchObject({ name: 'Initials', kind: 'initials', width: 21, height: 18 });
    expect((await repository.get('signatures', item!.id))!.png.byteLength).toBeGreaterThan(0);
  });

  it('shows the size and decode problems and lets the user choose again', async () => {
    decode
      .mockResolvedValueOnce({
        ok: false,
        problems: [{ code: 'signature.too-large', data: { limitMb: 20 } }],
      })
      .mockRejectedValueOnce(new Error('canvas gone'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<UploadDialog open onClose={() => undefined} />);
    const input = screen.getByLabelText('Image file');
    await user.upload(input, file);
    expect(await screen.findByRole('alert')).toHaveTextContent('over 20 MB');
    await user.upload(input, file);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('could not read that image'),
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    // Choosing nothing changes nothing.
    fireEvent.change(input, { target: { files: [] } });
    expect(decode).toHaveBeenCalledTimes(2);
    expect(input).toHaveValue('');
    error.mockRestore();
  });

  it('says so when nothing is left, and when saving fails', async () => {
    decode.mockResolvedValue(decoded);
    const trim = vi.spyOn(pixels, 'trimAndEncode').mockRejectedValueOnce(new Error('encode'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<UploadDialog open onClose={onClose} />);
    await user.upload(screen.getByLabelText('Image file'), file);
    await screen.findByRole('slider');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');
    trim.mockRestore();
    const blank = { ...decoded.value.full, data: new Uint8ClampedArray(40 * 20 * 4).fill(255) };
    decode.mockResolvedValue({ ok: true, value: { full: blank, preview: blank } });
    await user.upload(screen.getByLabelText('Image file'), file);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(NOTHING_LEFT));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    error.mockRestore();
  });
});
