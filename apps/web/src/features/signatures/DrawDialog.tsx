// Draw a signature with a mouse, a finger or a pen (spec §8.1, G2, G3).
import type { SignatureMeta } from '@bogey/core';
import { useId, useRef, useState } from 'react';
import { useSignaturesStore } from '../../state/signatures.ts';
import { Button } from '../../ui/Button.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { messageFor } from '../../ui/messages.ts';
import { NameAndKind, useNameAndKind } from './NameAndKind.tsx';
import { SignaturePadModel } from './padModel.ts';
import { TRIM_PADDING, trimAndEncode } from './pixels.ts';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad.tsx';
import styles from './Signatures.module.css';

/** Shown when the browser fails to encode or store the image, which should not happen. */
export const SAVE_FAILED = 'The signature could not be saved. Try again.';

export interface DrawDialogProps {
  open: boolean;
  onClose(): void;
  onSaved?: ((signature: SignatureMeta) => void) | undefined;
}

export function DrawDialog({ open, onClose, onSaved }: DrawDialogProps) {
  return (
    <Dialog open={open} title="Draw a signature" onClose={onClose}>
      <DrawForm onClose={onClose} onSaved={onSaved} />
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so each opening starts blank. */
function DrawForm({ onClose, onSaved }: Omit<DrawDialogProps, 'open'>) {
  const [model] = useState(() => new SignaturePadModel());
  const pad = useRef<SignaturePadHandle>(null);
  const fields = useNameAndKind();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const add = useSignaturesStore((state) => state.add);
  const hintId = useId();

  const save = async () => {
    if (model.isEmpty) {
      setError(messageFor({ code: 'signature.empty' }));
      return;
    }
    setSaving(true);
    try {
      const handle = pad.current!;
      const encoded = await trimAndEncode(handle.read(), TRIM_PADDING * handle.scale);
      if (!encoded) {
        setError(messageFor({ code: 'signature.empty' }));
        return;
      }
      const saved = await add({ ...fields.value, ...encoded });
      onSaved?.(saved);
      onClose();
    } catch (cause) {
      console.error('Saving a drawn signature failed', cause);
      setError(SAVE_FAILED);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.wide}>
      <p id={hintId} className={styles.hint}>
        Sign in the box with a mouse, a finger or a pen. Drawing needs a pointer, so if you use the
        keyboard, upload an image of your signature instead.
      </p>
      <SignaturePad
        model={model}
        handle={pad}
        label="Signature drawing area"
        describedBy={hintId}
        onChange={() => setError(null)}
      />
      <NameAndKind {...fields} />
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <Button className={styles.push} onClick={() => pad.current?.clear()}>
          Clear
        </Button>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={saving} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </div>
  );
}
