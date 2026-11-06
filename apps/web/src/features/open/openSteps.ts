// The open sequence (spec §6.1) as an ordered list of named steps. Each step reads and fills in the
// session; a step that fails or is cancelled stops the sequence, and the steps already done are
// undone in reverse order. Sprint 6 adds its persistence step to OPEN_STEPS after `read`, with an
// `undo` that deletes the record it created.
import type { PdfInfo, Problem } from '@bogey/core';
import { LIMITS } from '../../config.ts';
import type { PdfBridge } from '../../core-bridge/pdf.ts';
import type { PdfDisplayDocument, PdfjsLoader } from '../../pdfjs/index.ts';
import { readPdf, type FileLike } from './accept.ts';

export interface OpenSession {
  readonly id: string;
  readonly name: string;
  readonly file: FileLike;
  bytes: Uint8Array | null;
  info: PdfInfo | null;
  display: PdfDisplayDocument | null;
  /** Memory only (D3). */
  password: string | null;
}

export interface OpenServices {
  bridge: PdfBridge;
  loader: PdfjsLoader;
  /** Asks the user for the password; resolves null if they cancel. */
  askPassword(reason: Problem): Promise<string | null>;
}

export type StepOutcome =
  { kind: 'next' } | { kind: 'cancelled' } | { kind: 'failed'; problem: Problem };

export interface OpenStep {
  readonly name: string;
  run(session: OpenSession, services: OpenServices): Promise<StepOutcome>;
  /** Reverses the step's effects when a later step fails or the user cancels. */
  undo?(session: OpenSession, services: OpenServices): Promise<void>;
}

const NEXT: StepOutcome = { kind: 'next' };
const failed = (problem: Problem): StepOutcome => ({ kind: 'failed', problem });

const isPasswordProblem = (problem: Problem) =>
  problem.code === 'pdf.password-required' || problem.code === 'pdf.password-wrong';

/** Steps 1–2: size limit, read, header check. */
export const readStep: OpenStep = {
  name: 'read',
  async run(session) {
    const result = await readPdf(session.file);
    if (!result.ok) return failed(result.problems[0]!);
    session.bytes = result.value;
    return NEXT;
  },
};

/**
 * Steps 4–5: inspect in the pdf worker and load into pdf.js, in parallel, asking for the password
 * until it is right or the user cancels (D3).
 */
export const inspectAndLoadStep: OpenStep = {
  name: 'inspect-and-load',
  async run(session, { bridge, loader, askPassword }) {
    const bytes = session.bytes!;
    let password: string | undefined;
    for (;;) {
      const [inspected, loaded] = await Promise.all([
        bridge.inspect(bytes, password),
        loader.load(bytes, password),
      ]);
      if (inspected.ok && loaded.ok) {
        session.info = inspected.value;
        session.display = loaded.value;
        session.password = password ?? null;
        return NEXT;
      }
      if (loaded.ok) await loaded.value.destroy();
      const problems = [
        ...(loaded.ok ? [] : loaded.problems),
        ...(inspected.ok ? [] : inspected.problems),
      ];
      if (!problems.some(isPasswordProblem)) return failed(problems[0]!);
      const answer = await askPassword({
        code: password === undefined ? 'pdf.password-required' : 'pdf.password-wrong',
      });
      if (answer === null) return { kind: 'cancelled' };
      password = answer;
    }
  },
  async undo(session) {
    const display = session.display;
    session.display = null;
    await display?.destroy();
  },
};

/** The page-count limit (spec §11.4), known once pdf.js has the document. */
export const limitsStep: OpenStep = {
  name: 'check-limits',
  run(session) {
    return Promise.resolve(
      session.display!.pageCount > LIMITS.maxPages
        ? failed({ code: 'file.too-many-pages', data: { limit: LIMITS.maxPages } })
        : NEXT,
    );
  },
};

export const OPEN_STEPS: readonly OpenStep[] = [readStep, inspectAndLoadStep, limitsStep];

/** Undoes completed steps, latest first. A failing undo is logged and the rest still run. */
export async function undoSteps(
  steps: readonly OpenStep[],
  session: OpenSession,
  services: OpenServices,
): Promise<void> {
  for (const step of [...steps].reverse()) {
    try {
      await step.undo?.(session, services);
    } catch (error) {
      console.error(`Undoing the ${step.name} step failed`, error);
    }
  }
}

/** Runs the steps in order. An unexpected exception counts as a damaged document (spec §12). */
export async function runSteps(
  steps: readonly OpenStep[],
  session: OpenSession,
  services: OpenServices,
): Promise<StepOutcome> {
  const done: OpenStep[] = [];
  for (const step of steps) {
    let outcome: StepOutcome;
    try {
      outcome = await step.run(session, services);
    } catch (error) {
      console.error(`The ${step.name} step failed`, error);
      outcome = failed({ code: 'pdf.damaged' });
    }
    if (outcome.kind !== 'next') {
      await undoSteps(done, session, services);
      return outcome;
    }
    done.push(step);
  }
  return NEXT;
}
