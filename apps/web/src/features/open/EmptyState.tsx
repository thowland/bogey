// The empty state (U5): drop zone, recent documents, and the privacy statement. The password
// dialog lives here too, since a document that needs one is not open yet.
import { useViewStore } from '../../state/view.ts';
import { DropZone } from './DropZone.tsx';
import { PasswordDialog } from './PasswordDialog.tsx';
import { RecentDocuments } from './RecentDocuments.tsx';
import styles from './EmptyState.module.css';

export function EmptyState() {
  const setScreen = useViewStore((state) => state.setScreen);
  return (
    <div className={styles.empty}>
      <DropZone />
      <PasswordDialog />
      <section className={styles.recent} aria-labelledby="recent-heading">
        <h2 id="recent-heading">Recent documents</h2>
        <RecentDocuments />
      </section>
      <p className={styles.privacy}>
        Bogey works entirely inside this browser. The PDF you open, what you type into it and the
        signatures you save stay on this device, because there is no server for them to go to and
        the site’s security policy stops the page from sending them anywhere.{' '}
        <button type="button" className={styles.link} onClick={() => setScreen('privacy')}>
          How to check this yourself
        </button>
      </p>
    </div>
  );
}
