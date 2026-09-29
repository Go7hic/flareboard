import { env } from 'cloudflare:workers';
import { hashPassword } from '@flareboard/shared';
import { base32Decode, hotp, totpStep } from '../../src/lib/totp';
import { SESSION_COOKIE } from '../../src/lib/session-cookie';
import { fetchWorker } from './fetch-worker';

export const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
export const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';

/** Distinct client IPs keep tests clear of each other's per-IP limits. */
export function testIp() {
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return `10.${bytes[0]}.${bytes[1]}.${bytes[2]}`;
}

export async function createTestUser(username: string, password: string, extra: { email?: string; verified?: boolean } = {}) {
  const userId = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO user (user_id, username, password, role, email, email_verified_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'user', ?4, ?5, ?6, ?6)`,
  )
    .bind(userId, username, hashPassword(password, 4), extra.email ?? null, extra.verified ? now : null, now)
    .run();
  return userId;
}

export function sessionTokenFrom(response: Response): string | null {
  const header = response.headers.get('Set-Cookie') ?? '';
  const match = header.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export async function postJson(path: string, body: unknown, init: { token?: string; ip?: string; ua?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.ip) headers['cf-connecting-ip'] = init.ip;
  if (init.ua) headers['User-Agent'] = init.ua;
  const response = await fetchWorker(path, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { response, body: json ?? {}, token: sessionTokenFrom(response) };
}

export async function call(path: string, token: string, init: RequestInit = {}) {
  const response = await fetchWorker(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const body = (await response.json().catch(() => null)) as unknown;
  return { response, body: body as Record<string, any>, token: sessionTokenFrom(response) };
}

export async function login(username: string, password: string, init: { ip?: string; ua?: string } = {}) {
  return postJson('/api/auth/login', { username, password }, { ip: init.ip ?? testIp(), ua: init.ua });
}

/** A valid code for `secret` at a step offset from now (+1 is still inside the accepted window). */
export async function totpCode(secret: string, offset = 0) {
  return hotp(base32Decode(secret), totpStep(Date.now()) + offset);
}
