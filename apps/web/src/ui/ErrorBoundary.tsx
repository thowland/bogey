// Unexpected exceptions stop at the workspace and offer a reload (spec §12). The message never
// includes the exception text; that goes to the console.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './Button.tsx';
import styles from './ErrorBoundary.module.css';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Whether work is being saved, which changes what reloading costs. */
  saved: boolean;
  onReload(): void;
}

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Bogey workspace error', error, info.componentStack);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className={styles.failed}>
        <p>Something went wrong in Bogey and this view stopped working.</p>
        <Button variant="primary" onClick={this.props.onReload}>
          {this.props.saved ? 'Reload (your work is saved)' : 'Reload (unsaved work will be lost)'}
        </Button>
      </div>
    );
  }
}
