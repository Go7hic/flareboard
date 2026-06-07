import type { Env } from '../env';

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

function emailFrom(env: Env) {
  const from = env.EMAIL_FROM ?? 'noreply@flareboard.dev';
  const name = env.EMAIL_FROM_NAME ?? 'Flareboard';
  return { email: from, name };
}

/** Send via Cloudflare Email Sending binding, or log in dev when unconfigured. */
export async function sendEmail(env: Env, input: SendEmailInput): Promise<boolean> {
  const binding = env.EMAIL;
  if (!binding) {
    console.log(`[email] To: ${input.to}\nSubject: ${input.subject}\n${input.text}`);
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
