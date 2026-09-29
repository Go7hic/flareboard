/** Web Crypto helpers for account security data: keys are derived from APP_SECRET per purpose. */

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function toHex(bytes: ArrayBuffer | Uint8Array) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function deriveKey(appSecret: string, purpose: string, usage: 'aes' | 'hmac') {
  const base = await crypto.subtle.importKey('raw', encoder.encode(appSecret), 'HKDF', false, ['deriveKey']);
  const params = { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('flareboard'), info: encoder.encode(purpose) };
  return usage === 'aes'
    ? crypto.subtle.deriveKey(params, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    : crypto.subtle.deriveKey(params, base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
}

/** AES-256-GCM with a random IV; output is base64(iv || ciphertext). */
export async function sealSecret(appSecret: string, purpose: string, plaintext: string) {
  const key = await deriveKey(appSecret, purpose, 'aes');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext)));
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return toBase64(out);
}

export async function openSecret(appSecret: string, purpose: string, sealed: string) {
  const bytes = fromBase64(sealed);
  const key = await deriveKey(appSecret, purpose, 'aes');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
  return new TextDecoder().decode(plain);
}

/** Keyed hash for values that must be matched but never recovered (recovery codes, rate-limit keys). */
export async function keyedHash(appSecret: string, purpose: string, value: string) {
  const key = await deriveKey(appSecret, purpose, 'hmac');
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export function randomToken(bytes = 16) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}
