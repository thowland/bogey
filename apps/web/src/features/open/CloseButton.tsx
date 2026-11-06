// Close document (wave 3 note, plan §4): returns to the empty state and the recent list. It uses
// the existing close path, closeDocument(); the session controller saves the document's last
// state and stops tracking it, and the overlay reset clears its edits (Sprints 4 and 6).
import { useDocumentStore } from '../../state/document.ts';
import { useViewStore } from '../../state/view.ts';
import { Button } from '../../ui/Button.tsx';
import { closeDocument } from './openDocument.ts';

export function CloseButton() {
  const ready = useDocumentStore((state) => state.status === 'ready');
  if (!ready) return null;
  return (
    <Button
      variant="quiet"
      title="Close this document and show your recent documents"
      onClick={() => {
        useViewStore.getState().setScreen('workspace');
        void closeDocument();
      }}
    >
      Close PDF
    </Button>
  );
}
