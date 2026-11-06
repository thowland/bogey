import { PROBLEM_CODES } from '@bogey/core';
import { describe, expect, it } from 'vitest';
import { messageCodes, messageFor } from '../src/ui/messages.ts';

describe('problem messages (U6)', () => {
  it('has text for every problem code', () => {
    expect(new Set(messageCodes())).toEqual(new Set(PROBLEM_CODES));
  });

  it.each(PROBLEM_CODES)('%s reads as a plain sentence', (code) => {
    const text = messageFor({ code });
    expect(text).toMatch(/^[A-Z].*\.$/);
    expect(text).not.toMatch(/undefined|Error:|\[object/);
  });

  it('uses data where the message has a number', () => {
    expect(messageFor({ code: 'file.too-large', data: { limitMb: 10 } })).toContain('10 MB');
    expect(messageFor({ code: 'file.too-many-pages', data: { limit: 7 } })).toContain('7 pages');
    expect(messageFor({ code: 'signature.too-large', data: { limitMb: 3 } })).toContain('3 MB');
  });
});
