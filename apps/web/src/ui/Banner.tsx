import type { ReactNode } from 'react';
import styles from './Banner.module.css';

export interface BannerProps {
  tone?: 'info' | 'warning' | 'failure';
  children: ReactNode;
  /** Optional controls, such as a dismiss button. */
  actions?: ReactNode;
}

/** A persistent notice above the workspace (M3, D4, spec §11.7). */
export function Banner({ tone = 'info', children, actions }: BannerProps) {
  return (
    <div role={tone === 'info' ? 'status' : 'alert'} className={`${styles.banner} ${styles[tone]}`}>
      <div className={styles.text}>{children}</div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
