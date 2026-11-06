// The signature library (spec §8.3, G1, G5): thumbnails grouped by kind, each of which enters
// place-signature mode, with rename and delete. Placement itself belongs to Sprint 4, which
// reads `view.tool === 'signature'` and `view.selectedSignatureId`.
import type { SignatureKind, SignatureMeta } from '@bogey/core';
import { useEffect, useId, useRef, useState } from 'react';
import { useEditsStore } from '../../state/edits.ts';
import { MAX_SIGNATURE_NAME, useSignaturesStore } from '../../state/signatures.ts';
import { useViewStore } from '../../state/view.ts';
import { Button } from '../../ui/Button.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { DrawDialog } from './DrawDialog.tsx';
import { UploadDialog } from './UploadDialog.tsx';
import styles from './Signatures.module.css';

const GROUPS: readonly { kind: SignatureKind; title: string }[] = [
  { kind: 'signature', title: 'Signatures' },
  { kind: 'initials', title: 'Initials' },
];

type Open =
  | { dialog: 'none' }
  | { dialog: 'draw' }
  | { dialog: 'upload' }
  | { dialog: 'rename'; item: SignatureMeta }
  | { dialog: 'delete'; item: SignatureMeta };

export function SignaturesPanel() {
  const items = useSignaturesStore((state) => state.items);
  const [open, setOpen] = useState<Open>({ dialog: 'none' });
  const close = () => setOpen({ dialog: 'none' });
  const placing = useViewStore((state) =>
    state.tool === 'signature' ? state.selectedSignatureId : null,
  );
  const chooseSignature = useViewStore((state) => state.chooseSignature);

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <Button onClick={() => setOpen({ dialog: 'draw' })}>Draw</Button>
        <Button onClick={() => setOpen({ dialog: 'upload' })}>Upload</Button>
      </div>
      {items.length === 0 ? (
        <p className={styles.hint}>Signatures you draw or upload are kept here.</p>
      ) : (
        <>
          <p className={styles.hint} aria-live="polite">
            {placing
              ? 'Click the page where the signature should go.'
              : 'Choose a signature, then click the page where it should go.'}
          </p>
          {GROUPS.map(({ kind, title }) => (
            <Group
              key={kind}
              title={title}
              items={items.filter((item) => item.kind === kind)}
              placing={placing}
              onPlace={(item) => chooseSignature(placing === item.id ? null : item.id)}
              onRename={(item) => setOpen({ dialog: 'rename', item })}
              onDelete={(item) => setOpen({ dialog: 'delete', item })}
            />
          ))}
        </>
      )}
      <DrawDialog open={open.dialog === 'draw'} onClose={close} />
      <UploadDialog open={open.dialog === 'upload'} onClose={close} />
      <RenameDialog item={open.dialog === 'rename' ? open.item : null} onClose={close} />
      <DeleteDialog item={open.dialog === 'delete' ? open.item : null} onClose={close} />
    </div>
  );
}

interface GroupProps {
  title: string;
  items: readonly SignatureMeta[];
  placing: string | null;
  onPlace(item: SignatureMeta): void;
  onRename(item: SignatureMeta): void;
  onDelete(item: SignatureMeta): void;
}

function Group({ title, items, placing, onPlace, onRename, onDelete }: GroupProps) {
  const titleId = useId();
  if (items.length === 0) return null;
  return (
    <section className={styles.group} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.groupTitle}>
        {title}
      </h3>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.id} className={styles.item}>
            <button
              type="button"
              className={styles.place}
              aria-pressed={placing === item.id}
              aria-label={`Place ${item.name}`}
              onClick={() => onPlace(item)}
            >
              <Thumbnail id={item.id} />
              <span>{item.name}</span>
            </button>
            <div className={styles.itemActions}>
              <Button
                variant="quiet"
                aria-label={`Rename ${item.name}`}
                onClick={() => onRename(item)}
              >
                Rename
              </Button>
              <Button
                variant="quiet"
                aria-label={`Delete ${item.name}`}
                onClick={() => onDelete(item)}
              >
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The signature's PNG through a blob URL that is revoked when no longer shown (spec §11.7). */
function Thumbnail({ id }: { id: string }) {
  const png = useSignaturesStore((state) => state.images.get(id));
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    if (!png || !img) return;
    const url = URL.createObjectURL(png);
    img.src = url;
    return () => {
      img.removeAttribute('src');
      URL.revokeObjectURL(url);
    };
  }, [png]);
  return <img ref={ref} className={styles.thumb} alt="" />;
}

function RenameDialog({ item, onClose }: { item: SignatureMeta | null; onClose(): void }) {
  return (
    <Dialog open={item !== null} title="Rename" onClose={onClose}>
      {item && <RenameForm key={item.id} item={item} onClose={onClose} />}
    </Dialog>
  );
}

function RenameForm({ item, onClose }: { item: SignatureMeta; onClose(): void }) {
  const [name, setName] = useState(item.name);
  const rename = useSignaturesStore((state) => state.rename);
  const id = useId();
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void rename(item.id, name).then(onClose);
      }}
    >
      <label className={styles.field} htmlFor={id}>
        Name
        <input
          id={id}
          className={styles.input}
          value={name}
          maxLength={MAX_SIGNATURE_NAME}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className={styles.actions}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit">
          Save
        </Button>
      </div>
    </form>
  );
}

function DeleteDialog({ item, onClose }: { item: SignatureMeta | null; onClose(): void }) {
  const remove = useSignaturesStore((state) => state.remove);
  const overlays = useEditsStore((state) => state.present.overlays);
  const selected = useViewStore((state) => state.selectedSignatureId);
  const chooseSignature = useViewStore((state) => state.chooseSignature);
  const pages = item
    ? [
        ...new Set(
          overlays
            .filter((o) => o.type === 'signature' && o.signatureId === item.id)
            .map((o) => o.page + 1),
        ),
      ].sort((a, b) => a - b)
    : [];

  const confirm = () => {
    if (!item) return;
    if (selected === item.id) chooseSignature(null);
    void remove(item.id).then(onClose);
  };

  return (
    <Dialog
      open={item !== null}
      role="alertdialog"
      title={item ? `Delete “${item.name}”?` : 'Delete'}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={confirm}>
            Delete
          </Button>
        </>
      }
    >
      <p>This removes it from this browser. It cannot be undone.</p>
      {pages.length > 0 && (
        <p>
          It is placed on {pages.length === 1 ? 'page' : 'pages'} {pages.join(', ')} of the open
          document. Those copies stay on the page for now, but the download will not work until you
          remove them or place another signature.
        </p>
      )}
    </Dialog>
  );
}
