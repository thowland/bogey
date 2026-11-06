// Fixture PDFs for browser-mode tests, inlined by Vite on demand. Fetched fixtures are present only
// after `pnpm fixtures:fetch`.
const inlined = import.meta.glob<string>('../../../fixtures/**/*.pdf', {
  query: '?inline',
  import: 'default',
});

export const hasFixture = (path: string) => `../../../fixtures/${path}` in inlined;

/** A fixture's bytes, by path relative to fixtures/. */
export async function fixtureBytes(path: string): Promise<Uint8Array> {
  const load = inlined[`../../../fixtures/${path}`];
  if (!load) throw new Error(`No fixture ${path}`);
  const dataUrl = await load();
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
