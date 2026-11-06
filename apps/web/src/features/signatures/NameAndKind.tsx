// The name and kind fields shared by the draw and upload dialogs (spec §8.1). The name follows
// the kind ("Signature" or "Initials") until the user types their own.
import type { SignatureKind } from '@bogey/core';
import { useId, useState } from 'react';
import { DEFAULT_NAMES, MAX_SIGNATURE_NAME } from '../../state/signatures.ts';
import styles from './Signatures.module.css';

export interface NameAndKindValue {
  name: string;
  kind: SignatureKind;
}

export function useNameAndKind() {
  const [value, setValue] = useState<NameAndKindValue>({
    name: DEFAULT_NAMES.signature,
    kind: 'signature',
  });
  const [named, setNamed] = useState(false);
  return {
    value,
    setKind: (kind: SignatureKind) =>
      setValue((v) => ({ kind, name: named ? v.name : DEFAULT_NAMES[kind] })),
    setName: (name: string) => {
      setNamed(true);
      setValue((v) => ({ ...v, name }));
    },
  };
}

export function NameAndKind({ value, setKind, setName }: ReturnType<typeof useNameAndKind>) {
  const id = useId();
  return (
    <div className={styles.fields}>
      <label className={styles.field} htmlFor={`${id}-name`}>
        Name
        <input
          id={`${id}-name`}
          className={styles.input}
          value={value.name}
          maxLength={MAX_SIGNATURE_NAME}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <fieldset className={styles.kind}>
        <legend>Kind</legend>
        {(['signature', 'initials'] as const).map((kind) => (
          <label key={kind}>
            <input
              type="radio"
              name={`${id}-kind`}
              value={kind}
              checked={value.kind === kind}
              onChange={() => setKind(kind)}
            />
            {DEFAULT_NAMES[kind]}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
