import type { Context } from 'hono';
import { parseSecureToken } from '@flareboard/shared';
import type { Env } from '../env';
import { readAuthToken } from '../lib/auth-credentials';
import { getEnabledOAuthProviders } from '../lib/oauth';
import { isHostedMode, listPublicPlans } from '../lib/billing';
import { getAppSecret, json } from '../lib/response';

type Ctx = Context<{ Bindings: Env }>;

const SUPPORTED_LOCALES = ['en-US', 'zh-CN', 'ja-JP', 'de-DE', 'fr-FR'] as const;

function resolveLocale(c: Ctx): string {
  const stored = c.req.query('locale');
  if (stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)) return stored;

  const accept = (c.req.header('Accept-Language') ?? '').toLowerCase();
  if (accept.includes('zh')) return 'zh-CN';
  if (accept.includes('ja')) return 'ja-JP';
  if (accept.includes('de')) return 'de-DE';
  if (accept.includes('fr')) return 'fr-FR';
  return 'en-US';
}

export async function handleConfig(c: Ctx) {
  const ssoEnabled = Boolean(c.env.SSO_SECRET);
  const oauth = getEnabledOAuthProviders(c.env);
  const hosted = isHostedMode(c.env);

  let role: string | null = null;
  const token = readAuthToken(c);
  if (token) {
    const payload = await parseSecureToken(token, getAppSecret(c));
    if (payload?.role) role = String(payload.role);
  }

  return json({
    telemetry: false,
    updates: false,
    shareUrl: c.env.SHARE_URL ?? null,
    environment: c.env.ENVIRONMENT ?? 'development',
    version: '2.0.0',
    locale: resolveLocale(c),
    ssoEnabled,
    oauth,
    hosted,
    registrationEnabled: hosted,
    plans: hosted ? listPublicPlans() : [],
    disableLogin: c.env.DISABLE_LOGIN === 'true',
    teamsEnabled: true,
    linksEnabled: true,
    pixelsEnabled: true,
    trackerScriptName: 'script.js',
    recorderScriptName: 'recorder.js',
    scripts: ['script.js', 'recorder.js'],
    role,
  });
}
