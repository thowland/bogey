import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  /** Marks a toggle button's state for assistive technology. */
  pressed?: boolean;
}

export function Button({ variant = 'secondary', pressed, className, type, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type ?? 'button'}
      aria-pressed={pressed}
      className={[styles.button, styles[variant], className].filter(Boolean).join(' ')}
    />
  );
}
