// The shell for Help, About and Privacy: shown in place of the workspace, which stays mounted
// underneath; focus moves to the heading on open and back to the link on return (spec §10.4).
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useViewStore } from '../../state/view.ts';
import { Button } from '../../ui/Button.tsx';
import styles from './Page.module.css';

export function Page({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: ReactNode;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const setScreen = useViewStore((state) => state.setScreen);
  useEffect(() => heading.current?.focus(), []);
  return (
    <article className={styles.page}>
      <Button variant="quiet" onClick={() => setScreen('workspace')}>
        ← Back to your document
      </Button>
      <h1 ref={heading} tabIndex={-1}>
        {title}
      </h1>
      {lede && <p className={styles.lede}>{lede}</p>}
      {children}
    </article>
  );
}

/** A titled part of a page, named by its heading for screen readers' landmark lists. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={styles.section} aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}
