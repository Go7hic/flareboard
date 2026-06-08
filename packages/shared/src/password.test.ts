import { describe, expect, it } from 'vitest';
import { checkPassword, hashPassword } from './password';

describe('password helpers', () => {
  it('hashes and verifies a password', () => {
    const hash = hashPassword('flareboard-test');
    expect(hash).not.toBe('flareboard-test');
    expect(checkPassword('flareboard-test', hash)).toBe(true);
    expect(checkPassword('wrong-password', hash)).toBe(false);
  });
});
