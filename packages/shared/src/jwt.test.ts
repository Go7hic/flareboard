import { describe, expect, it } from 'vitest';
import {
  createSecureToken,
  createToken,
  parseAuthToken,
  parseSecureToken,
  parseToken,
} from './jwt';

const SECRET = 'test-secret-key';

describe('JWT helpers', () => {
  it('creates and parses a plain token', async () => {
    const token = await createToken({ userId: 'u1', role: 'admin' }, SECRET);
    const payload = await parseToken(token, SECRET);
    expect(payload?.userId).toBe('u1');
    expect(payload?.role).toBe('admin');
  });

  it('returns null for invalid or tampered tokens', async () => {
    expect(await parseToken('bad.token.here', SECRET)).toBeNull();
    const token = await createToken({ userId: 'u1' }, SECRET);
    expect(await parseToken(token, 'wrong-secret')).toBeNull();
  });

  it('round-trips secure (encrypted) tokens', async () => {
    const token = await createSecureToken({ userId: 'u2', role: 'user' }, SECRET);
    const payload = await parseSecureToken(token, SECRET);
    expect(payload?.userId).toBe('u2');
    expect(payload?.role).toBe('user');
  });

  it('parseAuthToken extracts Bearer token', async () => {
    const raw = await createSecureToken({ userId: 'u3', role: 'admin' }, SECRET);
    const payload = await parseAuthToken(`Bearer ${raw}`, SECRET);
    expect(payload?.userId).toBe('u3');
    expect(await parseAuthToken(null, SECRET)).toBeNull();
    expect(await parseAuthToken('Token abc', SECRET)).toBeNull();
  });
});
