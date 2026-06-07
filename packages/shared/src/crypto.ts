import { createHash, randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from 'node:crypto';
import { v4, v5 } from 'uuid';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const TAG_POSITION = SALT_LENGTH + IV_LENGTH;
const ENC_POSITION = TAG_POSITION + TAG_LENGTH;
const HASH_ALGO = 'sha512';
const HASH_ENCODING = 'hex' as const;

function getKey(password: string, salt: Buffer) {
  return pbkdf2Sync(password, salt, 10000, 32, 'sha512');
}

export function encrypt(value: string, secret: string): string {
  const iv = randomBytes(IV_LENGTH);
  const salt = randomBytes(SALT_LENGTH);
  const key = getKey(secret, salt);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
}

export function decrypt(value: string, secret: string): string {
  const str = Buffer.from(String(value), 'base64');
  const salt = str.subarray(0, SALT_LENGTH);
  const iv = str.subarray(SALT_LENGTH, TAG_POSITION);
  const tag = str.subarray(TAG_POSITION, ENC_POSITION);
  const encrypted = str.subarray(ENC_POSITION);
  const key = getKey(secret, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}

export function hash(...args: string[]): string {
  return createHash(HASH_ALGO).update(args.join('')).digest(HASH_ENCODING);
}

export function md5(...args: string[]): string {
  return createHash('md5').update(args.join('')).digest('hex');
}

export function getSecret(appSecret?: string): string {
  return hash(appSecret ?? 'flareboard-dev-secret');
}

export function uuid(...args: unknown[]): string {
  const secret = getSecret();
  if (args.length) {
    return v5(hash(...args.map(String), secret), v5.DNS);
  }
  return v4();
}

export function getSalt(createdAt: Date, rotation: 'day' | 'week' | 'month' = 'month'): string {
  const d = new Date(createdAt);
  if (rotation === 'day') {
    d.setUTCHours(0, 0, 0, 0);
  } else if (rotation === 'week') {
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - day);
    d.setUTCHours(0, 0, 0, 0);
  } else {
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
  }
  return hash(d.toUTCString());
}

export function visitSalt(createdAt: Date): string {
  const d = new Date(createdAt);
  d.setUTCMinutes(0, 0, 0);
  return hash(d.toUTCString());
}
