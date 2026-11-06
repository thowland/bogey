// Results and problems (spec §4). Core never throws for bad input: it returns a Result whose
// problems carry a stable code. The web app turns codes into text (apps/web/src/ui/messages.ts).

/** Every problem code core or the app can report. Codes are stable; never reuse one. */
export const PROBLEM_CODES = [
  // Opening (spec §6.1)
  'file.not-pdf',
  'file.too-large',
  'file.too-many-pages',
  'file.unreadable',
  'pdf.password-required',
  'pdf.password-wrong',
  'pdf.damaged',
  'pdf.timeout',
  // Export (spec §9)
  'export.failed',
  'export.verify-failed',
  'export.timeout',
  'export.signature-missing',
  'export.cannot-decrypt',
  // Storage (spec §10.5)
  'storage.unavailable',
  'storage.full',
  'storage.clear-failed',
  'storage.restore-missing',
  // Signatures (spec §8)
  'signature.empty',
  'signature.too-large',
  'signature.decode-failed',
  // Snippets (spec §10.6)
  'snippets.malformed',
  'snippets.too-large',
] as const;

export type ProblemCode = (typeof PROBLEM_CODES)[number];

export interface Problem {
  code: ProblemCode;
  /** Structured details for the message, e.g. `{ limitMb: 50 }`. Never shown raw. */
  data?: Readonly<Record<string, string | number | boolean>>;
}

export type Result<T, E = Problem> = { ok: true; value: T } | { ok: false; problems: E[] };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const fail = <E = Problem>(...problems: E[]): Result<never, E> => ({ ok: false, problems });
