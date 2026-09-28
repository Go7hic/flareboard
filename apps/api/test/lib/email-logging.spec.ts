import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/env';
import { logUndeliveredLink, sendEmail } from '../../src/lib/email';

const TOKEN = 'reset-token-3f9a';
const url = `https://flareboard.dev/login?reset=${TOKEN}`;

function captureConsole() {
  const lines: string[] = [];
  const record = (...args: unknown[]) => lines.push(args.map(String).join(' '));
  vi.spyOn(console, 'log').mockImplementation(record);
  vi.spyOn(console, 'error').mockImplementation(record);
  return lines;
}

const envFor = (ENVIRONMENT: string) => ({ ENVIRONMENT }) as unknown as Env;

describe('email logging never leaks one-time links in production', () => {
  afterEach(() => vi.restoreAllMocks());

  it('omits the message body when the email binding is missing in production', async () => {
    const lines = captureConsole();
    const sent = await sendEmail(envFor('production'), { to: 'a@b.co', subject: 'Reset', text: url, html: url });
    expect(sent).toBe(false);
    expect(lines.join('\n')).not.toContain(TOKEN);
    expect(lines.join('\n')).not.toContain('a@b.co');
    expect(lines.join('\n')).toContain('email_binding_missing');
  });

  it('logs only a token-free event for an undeliverable link in production', () => {
    const lines = captureConsole();
    logUndeliveredLink(envFor('production'), 'password-reset', 'user-1', url);
    expect(lines.join('\n')).not.toContain(TOKEN);
    expect(lines.join('\n')).toContain('email_link_undelivered');
  });

  it('still prints the link for local development', async () => {
    const lines = captureConsole();
    logUndeliveredLink(envFor('development'), 'password-reset', 'user-1', url);
    await sendEmail(envFor('development'), { to: 'a@b.co', subject: 'Reset', text: url, html: url });
    expect(lines.filter((line) => line.includes(TOKEN))).toHaveLength(2);
  });
});
