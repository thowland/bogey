import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Banner } from '../src/ui/Banner.tsx';
import { Button } from '../src/ui/Button.tsx';
import { Dialog } from '../src/ui/Dialog.tsx';
import { ErrorBoundary } from '../src/ui/ErrorBoundary.tsx';
import { Tabs } from '../src/ui/Tabs.tsx';
import { Toasts, useToastStore } from '../src/ui/Toast.tsx';

describe('Button', () => {
  it('defaults to type=button and exposes pressed state', () => {
    render(<Button pressed>Bold</Button>);
    const button = screen.getByRole('button', { name: 'Bold' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Tabs', () => {
  function Harness() {
    const [selected, setSelected] = useState<'a' | 'b' | 'c'>('a');
    return (
      <Tabs<'a' | 'b' | 'c'>
        label="Test"
        selected={selected}
        onSelect={setSelected}
        items={[
          { key: 'a', label: 'A', content: 'Panel A' },
          { key: 'b', label: 'B', content: 'Panel B' },
          { key: 'c', label: 'C', content: 'Panel C' },
        ]}
      />
    );
  }

  it('moves with arrow keys, Home and End, wrapping at the ends', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole('tab', { name: 'A' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'B' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel B');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'C' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'A' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'C' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'A' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'B' })).toHaveFocus();
    await user.keyboard('x');
    expect(screen.getByRole('tab', { name: 'B' })).toHaveFocus();
  });
});

describe('Dialog', () => {
  it('shows its content only while open and closes on Escape', async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog open={false} title="Export" onClose={onClose}>
        Body
      </Dialog>,
    );
    expect(screen.queryByText('Body')).toBeNull();
    rerender(
      <Dialog open title="Export" onClose={onClose} actions={<Button>OK</Button>}>
        Body
      </Dialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Export' })).toHaveTextContent('Body');
    expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
    screen.getByRole('dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalled();
    rerender(
      <Dialog open={false} title="Export" onClose={onClose}>
        Body
      </Dialog>,
    );
    expect(screen.queryByText('Body')).toBeNull();
  });
});

describe('Banner', () => {
  it('uses status for info and alert for warnings', () => {
    const { rerender } = render(<Banner actions={<Button>Dismiss</Button>}>Saved</Banner>);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    rerender(<Banner tone="failure">Broken</Banner>);
    expect(screen.getByRole('alert')).toHaveTextContent('Broken');
  });
});

describe('Toasts', () => {
  it('shows, runs and dismisses toasts', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(<Toasts />);
    act(() => {
      useToastStore.getState().show('A new version is ready.', { label: 'Reload', run });
      useToastStore.getState().show('Downloaded.');
    });
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(run).toHaveBeenCalled();
    expect(screen.queryByText('A new version is ready.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Downloaded.')).toBeNull();
  });
});

describe('ErrorBoundary', () => {
  function Broken(): never {
    throw new Error('boom');
  }

  it('offers a reload that says whether work is saved', async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount } = render(
      <ErrorBoundary saved onReload={onReload}>
        <Broken />
      </ErrorBoundary>,
    );
    await user.click(screen.getByRole('button', { name: 'Reload (your work is saved)' }));
    expect(onReload).toHaveBeenCalled();
    expect(screen.getByRole('alert')).not.toHaveTextContent('boom');
    unmount();
    render(
      <ErrorBoundary saved={false} onReload={onReload}>
        <Broken />
      </ErrorBoundary>,
    );
    expect(
      screen.getByRole('button', { name: 'Reload (unsaved work will be lost)' }),
    ).toBeInTheDocument();
  });
});
