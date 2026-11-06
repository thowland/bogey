// Accepting a file (D1, D2, spec §6.1 steps 1–2): refuse anything over the size limit before
// reading it, then decide the type by content, the way PDF readers do.
import type { Problem, Result } from '@bogey/core';
import { LIMITS } from '../../config.ts';

/** Readers look for the header within the first 1,024 bytes. */
const HEADER_WINDOW = 1024;
const HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

export function hasPdfHeader(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, HEADER_WINDOW) - HEADER.length;
  for (let start = 0; start <= end; start++) {
    if (HEADER.every((byte, offset) => bytes[start + offset] === byte)) return true;
  }
  return false;
}

// Result literals, since core's runtime helpers are reached only through core-bridge/ (spec §2.1).
const fail = (problem: Problem): Result<never, Problem> => ({ ok: false, problems: [problem] });

export type FileLike = Pick<Blob, 'size' | 'arrayBuffer'>;

export async function readPdf(file: FileLike): Promise<Result<Uint8Array, Problem>> {
  if (file.size > LIMITS.maxFileBytes) {
    return fail({ code: 'file.too-large', data: { limitMb: LIMITS.maxFileBytes / 1024 / 1024 } });
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    console.error('Reading the file failed', error);
    return fail({ code: 'file.unreadable' });
  }
  return hasPdfHeader(bytes) ? { ok: true, value: bytes } : fail({ code: 'file.not-pdf' });
}
