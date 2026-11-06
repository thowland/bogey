// Help, About and Privacy (U5, spec §10.4, §11.7): their sections, the shortcut list Help shares
// with the dialog, the version and build About shows, and Privacy's Clear everything.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { version } from '../package.json';
import { CANONICAL_URL, LIMITS } from '../src/config.ts';
import { SHORTCUTS } from '../src/features/help/shortcuts.ts';
import { AboutPage, HelpPage, PrivacyPage } from '../src/features/pages/index.ts';
import { useViewStore } from '../src/state/view.ts';

afterEach(() => useViewStore.getState().reset());

const sections = () =>
  screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);

describe('Help', () => {
  it('covers each task in its own named section, and focuses its heading', () => {
    render(<HelpPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Help' })).toHaveFocus();
    expect(sections()).toEqual([
      'Opening a document',
      'Filling form fields',
      'Text, checks and dates',
      'Signatures',
      'Snippets',
      'Downloading the signed copy',
      'Using an iPad',
      'Working offline',
      'Keyboard shortcuts',
    ]);
    expect(screen.getByRole('region', { name: 'Signatures' })).toHaveTextContent('Apple Pencil');
    expect(screen.getByRole('region', { name: 'Opening a document' })).toHaveTextContent(
      `${LIMITS.maxFileBytes / 1024 / 1024} MB`,
    );
  });

  it('lists every shortcut from the shortcuts dialog’s own list', () => {
    render(<HelpPage />);
    const keys = screen.getByRole('region', { name: 'Keyboard shortcuts' });
    for (const group of SHORTCUTS) {
      expect(within(keys).getByRole('heading', { level: 3, name: group.title })).toBeVisible();
      for (const item of group.items) expect(within(keys).getByText(item.action)).toBeVisible();
    }
  });

  it('goes back to the workspace', async () => {
    useViewStore.getState().setScreen('help');
    render(<HelpPage />);
    await userEvent.click(screen.getByRole('button', { name: /Back to your document/ }));
    expect(useViewStore.getState().screen).toBe('workspace');
  });
});

describe('About', () => {
  it('shows the version, build and canonical address, the license and the author', () => {
    render(<AboutPage />);
    expect(version).toBe('1.0.0');
    expect(screen.getByText(`Version ${version}`)).toBeVisible();
    const build = screen.getByRole('region', { name: 'Version and build' });
    expect(within(build).getByText('dev')).toBeVisible();
    expect(within(build).getByText(CANONICAL_URL)).toBeVisible();
    expect(screen.getByRole('link', { name: 'GNU General Public License' })).toHaveAttribute(
      'href',
      'https://www.gnu.org/licenses/gpl-3.0.html',
    );
    expect(screen.getByRole('link', { name: 'Mulligan' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Author and contact' })).toHaveTextContent(
      'Tim Howland',
    );
  });
});

describe('Privacy', () => {
  it('names what is kept, the expiry, how to check, and offline use', () => {
    render(<PrivacyPage />);
    expect(sections()).toEqual([
      'Nothing is sent',
      'Checking it yourself',
      'What is kept on this device',
      'Clearing everything',
      'Offline use and updates',
    ]);
    const kept = screen.getByRole('region', { name: 'What is kept on this device' });
    expect(kept).toHaveTextContent(`${LIMITS.documentExpiryDays} days`);
    expect(kept).toHaveTextContent('600,000 rounds of PBKDF2');
    expect(screen.getByRole('region', { name: 'Checking it yourself' })).toHaveTextContent(
      "connect-src 'self'",
    );
  });

  it('offers Clear everything with its confirmation', async () => {
    render(<PrivacyPage />);
    const clear = screen.getByRole('region', { name: 'Clearing everything' });
    await userEvent.click(within(clear).getByRole('button', { name: 'Clear everything' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Clear everything?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
