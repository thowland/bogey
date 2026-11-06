// Download (D8, E1–E9, spec §9): the toolbar button and Cmd/Ctrl+S. With nothing to warn about,
// export starts at once and the dialog appears only if it runs past 500 ms (E7) or fails. With
// characters to replace (E4), a password-protected original (E9) or a copy made from page images
// (spec §9.5), the dialog asks first.
import type { Problem } from '@bogey/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TIMING } from '../../config.ts';
import { useDocumentStore } from '../../state/document.ts';
import { useViewStore } from '../../state/view.ts';
import { Button } from '../../ui/Button.tsx';
import { useToastStore } from '../../ui/Toast.tsx';
import { ExportDialog, type Phase } from './ExportDialog.tsx';
import { defaultDeps, needsConfirmation, planExport, runExport } from './exportFlow.ts';

/** Cmd/Ctrl+S opens the export instead of the browser's Save Page (U2). */
export function isSaveKey(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 's'
  );
}

const FAILED: Problem = { code: 'export.failed' };

export function ExportButton() {
  const ready = useDocumentStore((state) => state.status === 'ready');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const running = useRef(false);
  const show = useToastStore((state) => state.show);

  const run = useCallback(
    async (replaceNonWinAnsi: boolean) => {
      if (running.current) return;
      running.current = true;
      setPhase({ kind: 'running', stage: null, visible: false });
      const timer = setTimeout(
        () => setPhase((p) => (p.kind === 'running' ? { ...p, visible: true } : p)),
        TIMING.exportProgressAfterMs,
      );
      const result = await runExport(
        { replaceNonWinAnsi },
        (stage) => setPhase((p) => (p.kind === 'running' ? { ...p, stage } : p)),
        defaultDeps(),
      );
      clearTimeout(timer);
      running.current = false;
      if (result.ok) {
        setPhase({ kind: 'idle' });
        show(`Downloaded ${result.value.fileName}.`);
      } else {
        setPhase({ kind: 'error', problem: result.problems[0] ?? FAILED });
      }
    },
    [show],
  );

  const start = useCallback(() => {
    if (running.current) return;
    const plan = planExport();
    if (!plan) return;
    if (needsConfirmation(plan)) setPhase({ kind: 'confirm', plan });
    else void run(false);
  }, [run]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSaveKey(event)) return;
      // The browser's Save Page would save the app, not the document.
      event.preventDefault();
      if (useViewStore.getState().screen !== 'workspace') return;
      if (event.target instanceof Element && event.target.closest('dialog')) return;
      start();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [start]);

  return (
    <>
      <Button
        variant="primary"
        disabled={!ready || phase.kind === 'running'}
        title="Download a signed copy (⌘S or Ctrl+S)"
        aria-keyshortcuts="Control+S Meta+S"
        onClick={start}
      >
        Download
      </Button>
      <ExportDialog
        phase={phase}
        onConfirm={(plan) => void run(plan.warnings.length > 0)}
        onClose={() => setPhase({ kind: 'idle' })}
      />
    </>
  );
}
