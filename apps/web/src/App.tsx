// The application shell (U1): toolbar across the top, thumbnails on the left, the page in the
// center, and a collapsible right panel with Fields, Snippets and Signatures. Every region is
// filled from a feature's index.ts, so concurrent sprints fill in their own feature without
// editing this file (implementation plan §1.4).
import { useDocumentStore } from './state/document.ts';
import { useStorageStore } from './state/storage.ts';
import { useViewStore, type PanelTab, type Screen } from './state/view.ts';
import { ExportButton } from './features/export/index.ts';
import { DocumentNotices, FieldsPanel } from './features/fields/index.ts';
import { ShortcutsHelp } from './features/help/index.ts';
import { CloseButton, EmptyState, OpenButton } from './features/open/index.ts';
import { ToolButtons, UndoRedo } from './features/overlays/index.ts';
import { AboutPage, HelpPage, PrivacyPage } from './features/pages/index.ts';
import { SettingsMenu } from './features/settings/index.ts';
import { SignaturesPanel } from './features/signatures/index.ts';
import { SnippetsPanel } from './features/snippets/index.ts';
import { StorageBanner } from './features/storage/index.ts';
import { PageControls, PageView, Thumbnails, ZoomControls } from './features/viewer/index.ts';
import { Button } from './ui/Button.tsx';
import { ErrorBoundary } from './ui/ErrorBoundary.tsx';
import { Tabs } from './ui/Tabs.tsx';
import { Toasts } from './ui/Toast.tsx';
import styles from './App.module.css';

const PAGES: Record<Exclude<Screen, 'workspace'>, () => React.JSX.Element> = {
  help: HelpPage,
  about: AboutPage,
  privacy: PrivacyPage,
};

const PANEL_TABS = [
  { key: 'fields', label: 'Fields', content: <FieldsPanel /> },
  { key: 'snippets', label: 'Snippets', content: <SnippetsPanel /> },
  { key: 'signatures', label: 'Signatures', content: <SignaturesPanel /> },
] as const satisfies readonly { key: PanelTab; label: string; content: React.ReactNode }[];

export function App() {
  const screen = useViewStore((state) => state.screen);
  const setScreen = useViewStore((state) => state.setScreen);
  const panelOpen = useViewStore((state) => state.panelOpen);
  const panelTab = useViewStore((state) => state.panelTab);
  const setPanel = useViewStore((state) => state.setPanel);
  const hasDocument = useDocumentStore((state) => state.status === 'ready');
  const saved = useStorageStore((state) => state.mode === 'persistent');
  const CurrentPage = screen === 'workspace' ? null : PAGES[screen];

  return (
    <div className={styles.app}>
      <header className={styles.toolbar}>
        <span className={styles.brand}>Bogey</span>
        <OpenButton />
        <CloseButton />
        <ToolButtons />
        <UndoRedo />
        <span className={styles.spacer} />
        <PageControls />
        <ZoomControls />
        <ExportButton />
        <nav aria-label="Information" className={styles.nav}>
          {(['help', 'about', 'privacy'] as const).map((page) => (
            <Button
              key={page}
              variant="quiet"
              aria-current={screen === page ? 'page' : undefined}
              onClick={() => setScreen(page)}
            >
              {page[0]!.toUpperCase() + page.slice(1)}
            </Button>
          ))}
        </nav>
        <ShortcutsHelp />
        <SettingsMenu />
        <Button
          variant="quiet"
          aria-expanded={panelOpen}
          aria-controls="side-panel"
          onClick={() => setPanel(!panelOpen)}
        >
          {panelOpen ? 'Hide panel' : 'Show panel'}
        </Button>
      </header>
      <StorageBanner />
      <DocumentNotices />
      <ErrorBoundary saved={saved} onReload={() => window.location.reload()}>
        <div className={styles.workspace} hidden={CurrentPage !== null}>
          <aside className={styles.thumbs} aria-label="Pages">
            <Thumbnails />
          </aside>
          <main className={styles.main}>{hasDocument ? <PageView /> : <EmptyState />}</main>
          <aside
            id="side-panel"
            className={styles.panel}
            hidden={!panelOpen}
            aria-label="Fields, snippets and signatures"
          >
            <Tabs
              label="Side panel"
              items={PANEL_TABS}
              selected={panelTab}
              onSelect={(tab) => setPanel(true, tab)}
            />
          </aside>
        </div>
        {CurrentPage && (
          <main className={styles.pageScreen}>
            <CurrentPage />
          </main>
        )}
      </ErrorBoundary>
      <Toasts />
    </div>
  );
}
