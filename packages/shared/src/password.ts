import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export function hashPassword(password: string, rounds = SALT_ROUNDS): string {
  return bcrypt.hashSync(password, rounds);
}

export function checkPassword(password: string, passwordHash: string): boolean {
  return bcrypt.compareSync(password, passwordHash);
}
