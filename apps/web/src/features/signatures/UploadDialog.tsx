// Upload a photo or scan of a signature and remove its background (spec §8.2, G4, S9).
import type { SignatureMeta } from '@bogey/core';
import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { NEAR_WHITE } from '../../core-bridge/image.ts';
import { useSignaturesStore } from '../../state/signatures.ts';
import { Button } from '../../ui/Button.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { messageFor } from '../../ui/messages.ts';
import { SAVE_FAILED } from './DrawDialog.tsx';
import { NameAndKind, useNameAndKind } from './NameAndKind.tsx';
import {
  TRIM_PADDING,
  decodeUpload,
  paintPixels,
  trimAndEncode,
  withoutBackground,
  type DecodedUpload,
} from './pixels.ts';
import styles from './Signatures.module.css';

export const NOTHING_LEFT =
  'Nothing is left once the background is removed. Move the slider to the right to keep more of the image.';

export interface UploadDialogProps {
  open: boolean;
  onClose(): void;
  onSaved?: ((signature: SignatureMeta) => void) | undefined;
}

export function UploadDialog({ open, onClose, onSaved }: UploadDialogProps) {
  return (
    <Dialog open={open} title="Upload a signature" onClose={onClose}>
      <UploadForm onClose={onClose} onSaved={onSaved} />
    </Dialog>
  );
}

type DecodeResult = Awaited<ReturnType<typeof decodeUpload>>;

type Stage = { step: 'choose' } | { step: 'reading' } | { step: 'adjust'; image: DecodedUpload };

/** Mounted only while the dialog is open, so each opening starts blank. */
function UploadForm({ onClose, onSaved }: Omit<UploadDialogProps, 'open'>) {
  const [stage, setStage] = useState<Stage>({ step: 'choose' });
  const [threshold, setThreshold] = useState<number>(NEAR_WHITE.default);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fields = useNameAndKind();
  const add = useSignaturesStore((state) => state.add);
  const preview = useRef<HTMLCanvasElement>(null);
  const id = useId();
  const image = stage.step === 'adjust' ? stage.image : null;

  // The preview works on a downscaled copy so the slider responds at once.
  useEffect(() => {
    if (image && preview.current) {
      paintPixels(preview.current, withoutBackground(image.preview, threshold));
    }
  }, [image, threshold]);

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Clear the input so that choosing the same file again (after an error) still reads it.
    event.target.value = '';
    if (!file) return;
    setError(null);
    setStage({ step: 'reading' });
    const decoded = await decodeUpload(file).catch((cause: unknown): DecodeResult => {
      console.error('Reading an uploaded signature failed', cause);
      return { ok: false, problems: [{ code: 'signature.decode-failed' }] };
    });
    if (decoded.ok) {
      setStage({ step: 'adjust', image: decoded.value });
    } else {
      setStage({ step: 'choose' });
      setError(messageFor(decoded.problems[0]!));
    }
  };

  const save = async () => {
    if (!image) return;
    setSaving(true);
    try {
      const encoded = await trimAndEncode(withoutBackground(image.full, threshold), TRIM_PADDING);
      if (!encoded) {
        setError(NOTHING_LEFT);
        return;
      }
      const saved = await add({ ...fields.value, ...encoded });
      onSaved?.(saved);
      onClose();
    } catch (cause) {
      console.error('Saving an uploaded signature failed', cause);
      setError(SAVE_FAILED);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.wide}>
      <label className={styles.field} htmlFor={`${id}-file`}>
        Image file
        <input
          id={`${id}-file`}
          type="file"
          accept="image/*"
          aria-describedby={`${id}-file-hint`}
          onChange={(event) => void choose(event)}
        />
      </label>
      <p id={`${id}-file-hint`} className={styles.hint}>
        Use a photo or scan of your signature in dark ink on white paper. PNG and JPEG work in every
        browser. Bogey keeps only the cleaned-up image, not the file you chose.
      </p>
      {stage.step === 'reading' && (
        <p className={styles.hint} role="status">
          Reading the image…
        </p>
      )}
      {image && (
        <>
          <canvas
            ref={preview}
            className={styles.preview}
            role="img"
            aria-label="Preview with the background removed"
          />
          <label className={styles.field} htmlFor={`${id}-threshold`}>
            Background cutoff: {threshold}
            <input
              id={`${id}-threshold`}
              className={styles.slider}
              type="range"
              min={NEAR_WHITE.min}
              max={NEAR_WHITE.max}
              step={1}
              value={threshold}
              aria-describedby={`${id}-threshold-hint`}
              onChange={(event) => {
                setError(null);
                setThreshold(Number(event.target.value));
              }}
            />
          </label>
          <p id={`${id}-threshold-hint`} className={styles.hint}>
            Anything lighter than the cutoff becomes transparent, shown here as a checkerboard. Move
            the slider left if the paper still shows, and right if parts of the signature fade out.
          </p>
          <NameAndKind {...fields} />
        </>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!image || saving} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </div>
  );
}
