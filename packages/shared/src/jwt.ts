import { SignJWT, jwtVerify } from 'jose';
import { decrypt, encrypt } from './crypto';

const encoder = new TextEncoder();

function secretKey(secret: string) {
  return encoder.encode(secret);
}

export async function createToken(
  payload: Record<string, unknown>,
  secret: string,
  expiresIn = '7d',
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey(secret));
}

export async function parseToken(token: string, secret: string) {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret));
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function createSecureToken(
  payload: Record<string, unknown>,
  secret: string,
  expiresIn = '7d',
): Promise<string> {
  const token = await createToken(payload, secret, expiresIn);
  return encrypt(token, secret);
}

export async function parseSecureToken(token: string, secret: string) {
  try {
    const decrypted = decrypt(token, secret);
    return parseToken(decrypted, secret);
  } catch {
    return null;
  }
}

export async function parseAuthToken(
  authorization: string | null | undefined,
  secret: string,
) {
  const token = authorization?.split(' ')?.[1];
  if (!token) return null;
  return parseSecureToken(token, secret);
}

export async function createCacheToken(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  return createToken(payload, secret, '1h');
}
