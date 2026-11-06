// The export dialog (spec §9): what will happen before it happens (E4, E9, §9.5), progress once
// export has run for 500 ms (E7), and the reason when it fails (U6).
import type { ExportWarning, Problem } from '@bogey/core';
import { useEditsStore } from '../../state/edits.ts';
import { Button } from '../../ui/Button.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { messageFor } from '../../ui/messages.ts';
import type { ExportPlan, FlowStage } from './exportFlow.ts';
import styles from './Export.module.css';

export type Phase =
  | { kind: 'idle' }
  | { kind: 'confirm'; plan: ExportPlan }
  | { kind: 'running'; stage: FlowStage | null; visible: boolean }
  | { kind: 'error'; problem: Problem };

export const STAGE_TEXT: Readonly<Record<FlowStage, string>> = {
  rendering: 'Drawing each page as an image…',
  loading: 'Reading the original…',
  fields: 'Filling in the form fields…',
  drawing: 'Adding your text, marks and signatures…',
  saving: 'Saving the copy…',
  checking: 'Checking the copy…',
};

export const ENCRYPTED_NOTICE =
  'The original was password-protected. The downloaded copy will not be.';
export const PAGE_IMAGES_NOTICE =
  'Bogey cannot rewrite this password-protected file directly, so the copy will be made from an image of each page. Its text will not be selectable or searchable.';
export const REPLACE_LABEL = 'Replace with ? and download';

interface ExportDialogProps {
  phase: Phase;
  onConfirm(plan: ExportPlan): void;
  onClose(): void;
}

export function ExportDialog({ phase, onConfirm, onClose }: ExportDialogProps) {
  if (phase.kind === 'confirm') {
    const { plan } = phase;
    const replacing = plan.warnings.length > 0;
    return (
      <Dialog
        open
        title="Download a signed copy"
        onClose={onClose}
        actions={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => onConfirm(plan)}>
              {replacing ? REPLACE_LABEL : 'Download'}
            </Button>
          </>
        }
      >
        {plan.pageImages && <p>{PAGE_IMAGES_NOTICE}</p>}
        {plan.encrypted && !plan.pageImages && <p>{ENCRYPTED_NOTICE}</p>}
        {replacing && <Preflight warnings={plan.warnings} />}
        <p className={styles.name}>
          The file will be saved as <strong>{plan.fileName}</strong>.
        </p>
      </Dialog>
    );
  }
  if (phase.kind === 'running') {
    return (
      <Dialog open={phase.visible} title="Preparing your download" onClose={() => undefined}>
        <progress className={styles.progress} aria-label="Export progress" />
        <p aria-live="polite">{phase.stage ? STAGE_TEXT[phase.stage] : 'Starting…'}</p>
      </Dialog>
    );
  }
  if (phase.kind === 'error') {
    return (
      <Dialog
        open
        role="alertdialog"
        title="The download did not work"
        onClose={onClose}
        actions={
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        }
      >
        <p>{messageFor(phase.problem)}</p>
      </Dialog>
    );
  }
  return null;
}

const quoted = (characters: readonly string[]) => characters.map((c) => `“${c}”`).join(' ');

/** E4: every overlay and field with characters Helvetica cannot write, and the characters. */
function Preflight({ warnings }: { warnings: readonly ExportWarning[] }) {
  const overlays = useEditsStore((state) => state.present.overlays);
  return (
    <>
      <p>
        Bogey writes text in Helvetica, which cannot show some of the characters you typed. Each of
        them will be replaced with a question mark in the download.
      </p>
      <ul className={styles.warnings}>
        {warnings.map((warning) => {
          const { subject } = warning;
          let what: string;
          if (subject.kind === 'overlay') {
            const overlay = overlays.find((o) => o.id === subject.id);
            const text =
              overlay && 'text' in overlay ? overlay.text.replace(/\s+/g, ' ').trim() : '';
            what = `Text on page ${subject.page + 1}${text ? `, “${text}”` : ''}`;
          } else {
            what = `The field “${subject.name}” on page ${subject.page + 1}`;
          }
          const key = subject.kind === 'overlay' ? subject.id : `field:${subject.name}`;
          return (
            <li key={key}>
              {what}: {quoted(warning.characters)}
            </li>
          );
        })}
      </ul>
    </>
  );
}
