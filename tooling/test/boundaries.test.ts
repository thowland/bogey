// Negative tests: prove the architectural guards reject violations (implementation plan, Sprint 0; spec §2.1).
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { cruise, type IConfiguration } from 'dependency-cruiser';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));
const fixtures = 'tooling/fixtures/boundaries';

describe('core tsconfig', () => {
  it('rejects DOM and Node globals in core code', async () => {
    const tsc = fileURLToPath(new URL('../../node_modules/.bin/tsc', import.meta.url));
    const error = await run(tsc, ['--noEmit', '-p', `${fixtures}/core-dom/tsconfig.json`], {
      cwd: root,
    }).then(
      () => null,
      (e: { stdout: string }) => e,
    );
    expect(error, 'core fixture should not compile').not.toBeNull();
    expect(error!.stdout).toMatch(/Cannot find name 'document'/);
    expect(error!.stdout).toMatch(/Cannot find name 'Buffer'/);
  });
});

describe('dependency-cruiser rules', () => {
  it('flag every forbidden dependency in the fixtures', async () => {
    const config = createRequire(import.meta.url)(
      '../../.dependency-cruiser.cjs',
    ) as IConfiguration;
    const result = await cruise([fixtures], {
      ...config.options,
      baseDir: root,
      ruleSet: { forbidden: config.forbidden ?? [] },
      validate: true,
    });
    const output = result.output as {
      summary: { violations: { rule: { name: string }; from: string; to: string }[] };
    };
    const found = output.summary.violations.map((v) => `${v.rule.name}: ${v.from} -> ${v.to}`);
    expect(found).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^core-no-node-builtins: .*uses-node\.ts -> (node:)?fs$/),
        expect.stringMatching(
          /^core-is-self-contained: .*uses-app\.ts -> .*apps\/web\/src\/app\.ts$/,
        ),
        expect.stringMatching(/^web-uses-core-entry-only: .*deep-import\.ts -> .*internal\.ts$/),
        expect.stringMatching(
          /^web-core-runtime-via-bridge: .*component\.ts -> .*core\/src\/index\.ts$/,
        ),
        expect.stringMatching(/^core-no-pdfjs: .*core\/src\/uses-pdfjs\.ts -> .*pdfjs-dist/),
        expect.stringMatching(
          /^web-pdfjs-only-in-pdfjs: .*web\/src\/uses-pdfjs\.ts -> .*pdfjs-dist/,
        ),
      ]),
    );
  });
});

describe('banned-API lint rules', () => {
  const eslint = new ESLint({ cwd: root });

  it.each([
    ['fetch', "fetch('/x');"],
    ['XMLHttpRequest', 'new XMLHttpRequest();'],
    ['WebSocket', "new WebSocket('wss://x');"],
    ['EventSource', "new EventSource('/x');"],
    ['URLSearchParams', 'new URLSearchParams();'],
    ['location.search', 'console.log(location.search);'],
    ['window.location.hash', 'console.log(window.location.hash);'],
    ['message listener', "window.addEventListener('message', () => {});"],
    ['onmessage', 'window.onmessage = null;'],
    ['sendBeacon', "navigator.sendBeacon('/x');"],
    ['window.open', "window.open('/x');"],
    ['window.opener', 'console.log(window.opener);'],
    ['service worker outside sw/register.ts', "navigator.serviceWorker.register('/sw.js');"],
    ['innerHTML', "document.body.innerHTML = '<b>x</b>';"],
    ['insertAdjacentHTML', "document.body.insertAdjacentHTML('beforeend', 'x');"],
    ['document.write', "document.write('x');"],
  ])('rejects %s in app code', async (_name, code) => {
    const [result] = await eslint.lintText(`${code}\nexport {};\n`, {
      filePath: 'apps/web/src/__lint-fixture__.ts',
    });
    const rules = result!.messages.map((m) => m.ruleId);
    expect(rules.some((r) => r === 'no-restricted-globals' || r === 'no-restricted-syntax')).toBe(
      true,
    );
  });

  it('rejects dangerouslySetInnerHTML in components', async () => {
    const [result] = await eslint.lintText(
      "export const X = () => <div dangerouslySetInnerHTML={{ __html: 'x' }} />;\n",
      { filePath: 'apps/web/src/__lint-fixture__.tsx' },
    );
    expect(result!.messages.map((m) => m.ruleId)).toContain('react/no-danger');
  });

  it('rejects focused and skipped tests', async () => {
    const [result] = await eslint.lintText(
      "import { it } from 'vitest';\nit.only('a', () => {});\nit.skip('b', () => {});\n",
      { filePath: 'apps/web/test/__lint-fixture__.test.ts' },
    );
    const rules = result!.messages.map((m) => m.ruleId);
    expect(rules).toContain('vitest/no-focused-tests');
    expect(rules).toContain('vitest/no-disabled-tests');
  });

  it('allows the service worker its two exceptions only (spec §11.5)', async () => {
    const [register] = await eslint.lintText(
      "navigator.serviceWorker.register('/sw.js');\nexport {};\n",
      { filePath: 'apps/web/src/sw/register.ts' },
    );
    expect(register!.messages).toEqual([]);
    const [worker] = await eslint.lintText("void fetch('/index.html');\nexport {};\n", {
      filePath: 'apps/web/src/sw/sw.ts',
    });
    expect(worker!.messages).toEqual([]);
    const [workerXhr] = await eslint.lintText('new XMLHttpRequest();\nexport {};\n', {
      filePath: 'apps/web/src/sw/sw.ts',
    });
    expect(workerXhr!.messages.map((m) => m.ruleId)).toContain('no-restricted-globals');
  });

  it('accepts ordinary app code', async () => {
    const [result] = await eslint.lintText("export const label = 'Bogey';\n", {
      filePath: 'apps/web/src/__lint-fixture__.ts',
    });
    expect(result!.messages).toEqual([]);
  });
});
