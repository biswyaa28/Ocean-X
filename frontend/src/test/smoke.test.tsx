import { describe, it, expect } from 'vitest';

describe('test infrastructure', () => {
  it('runs with jsdom', () => {
    expect(typeof document).toBe('object');
  });
});
