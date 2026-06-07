import { createHmac, timingSafeEqual } from 'node:crypto';

const SSO_TTL_MS = 5 * 60 * 1000;

export interface SsoPayload {
  userId: string;
  role: string;
  username?: string;
  exp: number;
}

/** Create an SSO token for external IdP handoff (HMAC-SHA256, base64url). */
export function createSsoToken(payload: Omit<SsoPayload, 'exp'>, secret: string, ttlMs = SSO_TTL_MS): string {
  const body: SsoPayload = { ...payload, exp: Date.now() + ttlMs };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySsoToken(token: string, secret: string): SsoPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = createHmac('sha256', secret).update(encoded).digest('base64url');
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SsoPayload;
    if (!payload.userId || !payload.role || !payload.exp) return null;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
