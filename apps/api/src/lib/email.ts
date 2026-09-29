import type { Env } from '../env';

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
};

function emailFrom(env: Env) {
  const from = env.EMAIL_FROM ?? 'noreply@flareboard.dev';
  const name = env.EMAIL_FROM_NAME ?? 'Flareboard';
  return { email: from, name };
}

/**
 * Emails carry one-time tokens (verify / reset links) and Workers Logs are retained in
 * production, so message bodies and links are only ever printed outside production.
 */
function isProduction(env: Env) {
  return env.ENVIRONMENT === 'production';
}

/** A link we could not email: printed for local dev, reduced to a token-free event in production. */
export function logUndeliveredLink(env: Env, kind: 'password-reset' | 'verify-email', userId: string, url: string) {
  if (isProduction(env)) {
    console.error(JSON.stringify({ event: 'email_link_undelivered', kind, userId }));
    return;
  }
  console.log(`[${kind}] Link for ${userId}: ${url}`);
}

/** Send via Cloudflare Email Sending binding, or log in dev when unconfigured. */
export async function sendEmail(env: Env, input: SendEmailInput): Promise<boolean> {
  const binding = env.EMAIL;
  if (!binding) {
    if (isProduction(env)) {
      console.error(JSON.stringify({ event: 'email_binding_missing', subject: input.subject }));
    } else {
      console.log(`[email] To: ${input.to}\nSubject: ${input.subject}\n${input.text}`);
    }
    return false;
  }

  try {
    await binding.send({
      to: input.to,
      from: emailFrom(env),
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    return true;
  } catch (err) {
    console.error('[email] send failed', err);
    throw err;
  }
}

export async function sendVerificationEmail(env: Env, to: string, verifyUrl: string) {
  return sendEmail(env, {
    to,
    subject: 'Verify your Flareboard account',
    text: `Welcome to Flareboard!\n\nVerify your email:\n${verifyUrl}\n\nThis link expires in 24 hours.`,
    html: `<p>Welcome to Flareboard!</p><p><a href="${verifyUrl}">Verify your email</a></p><p>This link expires in 24 hours.</p>`,
  });
}

export async function sendPasswordResetEmail(env: Env, to: string, resetUrl: string) {
  return sendEmail(env, {
    to,
    subject: 'Reset your Flareboard password',
    text: `Reset your password:\n${resetUrl}\n\nThis link expires in 1 hour.`,
    html: `<p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in 1 hour.</p>`,
  });
}
