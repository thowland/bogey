// The bridge between the open sequence, which waits for a password, and the password dialog,
// which supplies one (D3). One question is outstanding at a time.
import type { Problem } from '@bogey/core';
import { useDocumentStore } from '../../state/document.ts';

let pending: ((password: string | null) => void) | null = null;

/** Shows the password dialog with `reason` and waits for an answer; null means cancelled. */
export function askPassword(reason: Problem): Promise<string | null> {
  cancelPasswordPrompt();
  useDocumentStore.getState().update({ status: 'password', problem: reason });
  return new Promise((resolve) => {
    pending = resolve;
  });
}

/** The dialog's answer: a password to try, or null to cancel. */
export function answerPassword(password: string | null): void {
  const resolve = pending;
  pending = null;
  resolve?.(password);
}

/** Withdraws an outstanding question, as if cancelled (a newer open supersedes it). */
export function cancelPasswordPrompt(): void {
  answerPassword(null);
}
