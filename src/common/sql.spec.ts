import { describe, expect, it } from 'vitest';
import { likePattern } from './sql';

describe('likePattern', () => {
  it('wraps plain text so it matches anywhere', () => {
    expect(likePattern('plumb')).toBe('%plumb%');
  });

  it('escapes wildcard characters so they match literally', () => {
    expect(likePattern('a%b_c\\d')).toBe('%a\\%b\\_c\\\\d%');
  });
});