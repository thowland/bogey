// The same repository against the browser's real IndexedDB, binary values included (spec §10.5).
import { describe, expect, it } from 'vitest';
import { openRepository } from '../src/state/persistence.ts';

describe('repository in a real browser', () => {
  it('stores binary data and clears fail-closed', async () => {
    const repo = await openRepository();
    expect(repo.mode).toBe('persistent');
    await repo.put('documentBytes', {
      id: 'b',
      bytes: new Uint8Array([37, 80, 68, 70]).buffer,
      size: 4,
      sha256: 'x',
    });
    const record = await repo.get('documentBytes', 'b');
    expect(new Uint8Array(record!.bytes)).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(repo.mode).toBe('persistent');
    await repo.clearEverything();
    const reopened = await openRepository();
    expect(await reopened.getAll('documentBytes')).toEqual([]);
    await reopened.clearEverything();
  });
});
