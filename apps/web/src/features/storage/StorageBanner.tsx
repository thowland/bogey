// Notices about what is kept in this browser: memory-only mode (M3), a document opened without
// being saved, a restore that found nothing, a failed Clear everything, and the first-save notice
// (spec §11.7).
import { ClearEverything } from '../settings/ClearEverything.tsx';
import {
  dismissFirstSaveNotice,
  useSessionStore,
  type SessionNotice,
} from '../../state/session.ts';
import { useStorageStore } from '../../state/storage.ts';
import { Banner } from '../../ui/Banner.tsx';
import { Button } from '../../ui/Button.tsx';
import { messageFor } from '../../ui/messages.ts';

const NOTICES: Record<SessionNotice, { tone: 'info' | 'warning'; text: string }> = {
  'restore-missing': { tone: 'info', text: messageFor({ code: 'storage.restore-missing' }) },
  'memory-only': {
    tone: 'warning',
    text: 'Opened, but not saved on this device. Storage for this site is nearly full, so this document will be lost when the tab closes. Deleting documents from the recent list frees space.',
  },
  'record-unreadable': {
    tone: 'info',
    text: 'A saved document could not be read, so it was removed from this browser.',
  },
};

export function StorageBanner() {
  const reason = useStorageStore((state) => state.degradeReason);
  const notice = useSessionStore((state) => state.notice);
  const setNotice = useSessionStore((state) => state.setNotice);
  const firstSave = useSessionStore((state) => state.firstSaveNotice);
  const saving = useSessionStore((state) => state.saving);

  return (
    <>
      {reason && (
        <Banner tone="warning">
          {messageFor({ code: reason === 'full' ? 'storage.full' : 'storage.unavailable' })}
        </Banner>
      )}
      {!saving && <Banner tone="warning">{messageFor({ code: 'storage.clear-failed' })}</Banner>}
      {notice && (
        <Banner
          tone={NOTICES[notice].tone}
          actions={
            <Button variant="quiet" onClick={() => setNotice(null)}>
              Dismiss
            </Button>
          }
        >
          {NOTICES[notice].text}
        </Banner>
      )}
      {firstSave && saving && (
        <Banner
          actions={
            <>
              <ClearEverything />
              <Button variant="quiet" onClick={() => void dismissFirstSaveNotice()}>
                Got it
              </Button>
            </>
          }
        >
          Bogey keeps your documents, signatures and snippets in this browser so you can pick up
          where you left off. They stay on this device until you clear them, and a document you have
          not changed for 30 days is removed.
        </Banner>
      )}
    </>
  );
}
