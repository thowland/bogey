// Clear everything (S7, spec §10.5): one confirmation, then a fail-closed deletion of the database.
// The page reloads only after the browser confirms; otherwise nothing on screen changes, saving
// stops, and the message says how to remove the data by hand.
import { useState } from 'react';
import { clearEverything } from '../storage/start.ts';
import { Button } from '../../ui/Button.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { messageFor } from '../../ui/messages.ts';

type Phase = 'closed' | 'confirm' | 'clearing' | 'failed';

export interface ClearEverythingProps {
  /** Called after the browser confirmed the deletion; reloads the page by default. */
  reload?: () => void;
}

export function ClearEverything({ reload }: ClearEverythingProps) {
  const [phase, setPhase] = useState<Phase>('closed');
  const close = () => setPhase((current) => (current === 'clearing' ? current : 'closed'));

  const confirm = async () => {
    setPhase('clearing');
    const cleared = await clearEverything(reload);
    if (!cleared) setPhase('failed');
  };

  return (
    <>
      <Button variant="quiet" onClick={() => setPhase('confirm')}>
        Clear everything
      </Button>
      <Dialog
        open={phase !== 'closed'}
        role="alertdialog"
        title={phase === 'failed' ? 'Saved data may remain' : 'Clear everything?'}
        onClose={close}
        actions={
          phase === 'failed' ? (
            <Button onClick={close}>Close</Button>
          ) : (
            <>
              <Button onClick={close} disabled={phase === 'clearing'}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={phase === 'clearing'}
                onClick={() => void confirm()}
              >
                {phase === 'clearing' ? 'Clearing…' : 'Clear everything'}
              </Button>
            </>
          )
        }
      >
        {phase === 'failed' ? (
          <p role="alert">{messageFor({ code: 'storage.clear-failed' })}</p>
        ) : (
          <p>
            This removes every document, signature and snippet saved in this browser, and then
            reloads the page. It cannot be undone. Download any signed copies you need first.
          </p>
        )}
      </Dialog>
    </>
  );
}
