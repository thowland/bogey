import { describe, expect, it } from 'vitest';
import { portBase, ports } from '../../scripts/ports.mjs';

describe('ports per checkout (implementation plan §1.4)', () => {
  it('keeps the conventional ports in the main checkout', () => {
    expect(portBase('/Users/th/Apps/bogey', '')).toBe(4173);
  });

  it('gives worktrees distinct, stable ports away from the main checkout', () => {
    const a = portBase('/Users/th/Apps/bogey-worktrees/sprint-01-viewer', '');
    const b = portBase('/Users/th/Apps/bogey-worktrees/sprint-02-pdf-core', '');
    const c = portBase('/Users/th/Apps/bogey-worktrees/sprint-03-signature-capture', '');
    expect(new Set([a, b, c]).size).toBe(3);
    for (const base of [a, b, c]) {
      expect(base).toBeGreaterThanOrEqual(4200);
      expect(base).toBeLessThan(8200);
      expect(base % 10).toBe(0);
    }
    expect(portBase('/Users/th/Apps/bogey-worktrees/sprint-01-viewer', '')).toBe(a);
  });

  it('honours an override and derives the three ports from the base', () => {
    expect(portBase('/anywhere', '5000')).toBe(5000);
    expect(ports()).toEqual({
      preview: portBase(),
      e2e: portBase() + 1,
      dev: portBase() + 2,
    });
  });
});
