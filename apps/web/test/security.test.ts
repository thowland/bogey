import { describe, expect, it, vi } from 'vitest';
import { installDropGuard } from '../src/security/dropGuard.ts';
import { allowedScriptUrl, installTrustedTypesPolicy } from '../src/security/trustedTypes.ts';

const ORIGIN = 'https://bogey.beta-site.us';

describe('Trusted Types policy (spec §11.3)', () => {
  it.each([
    '/assets/pdf.worker-AbC123.js',
    '/assets/pdf.worker.min-x_Y-9.mjs',
    '/src/workers/pdf.worker.ts',
    '/node_modules/.pnpm/pdfjs-dist@6.5.438/node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
    '/sw.js',
    `${ORIGIN}/sw.js`,
  ])('allows %s', (path) => {
    expect(allowedScriptUrl(path, ORIGIN)).toBe(new URL(path, ORIGIN).href);
  });

  it.each([
    'https://evil.example/sw.js',
    '/assets/main-abc.js',
    '/sw.js?x=1',
    '/sw.js#x',
    'data:text/javascript,alert(1)',
    'blob:https://bogey.beta-site.us/123',
    'http://[bad',
  ])('rejects %s', (url) => {
    expect(allowedScriptUrl(url, ORIGIN)).toBeNull();
  });

  it('installs a default policy only where Trusted Types exist', () => {
    expect(installTrustedTypesPolicy(undefined, ORIGIN)).toBe(false);
    const createPolicy = vi.fn();
    expect(installTrustedTypesPolicy({ createPolicy }, ORIGIN)).toBe(true);
    const [name, rules] = createPolicy.mock.calls[0]! as [
      string,
      { createScriptURL(input: string): string | null },
    ];
    expect(name).toBe('default');
    expect(rules.createScriptURL('/sw.js')).toBe(`${ORIGIN}/sw.js`);
    expect(rules.createScriptURL('https://evil.example/x.js')).toBeNull();
  });
});

describe('drop guard (spec §11.2)', () => {
  it('cancels unclaimed drags and drops, and can be removed', () => {
    const target = new EventTarget();
    const remove = installDropGuard(target as unknown as Window);
    const dragover = new Event('dragover', { cancelable: true }) as DragEvent;
    Object.defineProperty(dragover, 'dataTransfer', { value: { dropEffect: 'copy' } });
    target.dispatchEvent(dragover);
    expect(dragover.defaultPrevented).toBe(true);
    expect(dragover.dataTransfer!.dropEffect).toBe('none');

    const claimed = new Event('dragover', { cancelable: true });
    claimed.preventDefault();
    target.dispatchEvent(claimed);

    const drop = new Event('drop', { cancelable: true });
    target.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);

    remove();
    const after = new Event('drop', { cancelable: true });
    target.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});
