// Sealing the saved edits of password-protected documents (maintainer's decision, Sprint 6; spec
// §10.5). Field values and overlays typed into a password-protected PDF are kept in IndexedDB
// encrypted with a key derived from that document's password, so reading them needs the password,
// as reading the PDF does.
//
// - Key: PBKDF2-HMAC-SHA-256, 600,000 iterations, a random 16-byte salt per document (made at the
//   first save and stored on the record), giving a non-extractable AES-GCM 256-bit CryptoKey. It is
//   derived once per session after the password has opened the document, held in memory only, and
//   never stored.
// - Each write encrypts JSON `{ fieldValues, overlays }` with AES-GCM under a fresh random 12-byte
//   IV, with the document id as additional authenticated data, so a sealed blob cannot be moved to
//   another record.
// - Opening fails closed: anything that does not decrypt and parse is reported as unreadable, and
//   nothing falls back to plaintext.
import type { DocumentEditState } from '@bogey/core';
import type { SealedEdits } from '../state/persistence.ts';

export const PBKDF2_ITERATIONS = 600_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const SEALED_VERSION = 1;

const encoder = new TextEncoder();

const subtle = (): SubtleCrypto => {
  const value = globalThis.crypto?.subtle;
  if (!value) throw new Error('Web Crypto is not available');
  return value;
};

/** Fresh random bytes as an ArrayBuffer of their own (stored as ArrayBuffer, spec §10.5). */
function randomBuffer(length: number): ArrayBuffer {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes.buffer;
}

export const newSalt = (): ArrayBuffer => randomBuffer(SALT_BYTES);

/** Derives the document's sealing key from its password and salt. */
export async function deriveSealingKey(
  password: string,
  salt: ArrayBuffer,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const material = await subtle().importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypts the edits for document `id` under a fresh IV. */
export async function sealEdits(
  key: CryptoKey,
  salt: ArrayBuffer,
  id: string,
  edits: DocumentEditState,
): Promise<SealedEdits> {
  const iv = randomBuffer(IV_BYTES);
  const plain = encoder.encode(
    JSON.stringify({ fieldValues: edits.fieldValues, overlays: edits.overlays }),
  );
  const data = await subtle().encrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv), additionalData: encoder.encode(id) },
    key,
    plain,
  );
  return { v: SEALED_VERSION, salt: salt.slice(0), iv, data };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Decrypts the edits sealed for document `id`. Returns null when the blob was altered, belongs to
 * another document, was sealed with another key, or does not hold an edit state.
 */
export async function unsealEdits(
  key: CryptoKey,
  id: string,
  sealed: SealedEdits,
): Promise<DocumentEditState | null> {
  if (sealed.v !== SEALED_VERSION) return null;
  try {
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(sealed.iv), additionalData: encoder.encode(id) },
      key,
      sealed.data,
    );
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as unknown;
    if (!isObject(parsed) || !isObject(parsed.fieldValues) || !Array.isArray(parsed.overlays)) {
      return null;
    }
    return parsed as unknown as DocumentEditState;
  } catch {
    return null;
  }
}
