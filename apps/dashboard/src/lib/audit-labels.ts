import type { AuditLogEntry } from './api';
import { t } from './i18n';

/**
 * Readable labels for account and team audit entries (`/api/me/audit-log`,
 * `/api/teams/:teamId/audit-log`), keyed by `${entityType}.${action}`.
 */
const AUDIT_LABEL_KEYS: Record<string, string> = {
  'user.login': 'auditUserLogin',
  'user.login_failed': 'auditUserLoginFailed',
  'user.password_change': 'auditUserPasswordChange',
  'user.password_reset': 'auditUserPasswordReset',
  'user.delete': 'auditUserDelete',
  'two_factor.enable': 'auditTwoFactorEnable',
  'two_factor.disable': 'auditTwoFactorDisable',
  'two_factor.recovery_codes_regenerate': 'auditTwoFactorRecoveryCodesRegenerate',
  'two_factor.recovery_code_used': 'auditTwoFactorRecoveryCodeUsed',
  'session.revoke': 'auditSessionRevoke',
  'session.revoke_others': 'auditSessionRevokeOthers',
  'personal_api_key.create': 'auditApiKeyCreate',
  'personal_api_key.delete': 'auditApiKeyDelete',
  'oauth_identity.link': 'auditOauthIdentityLink',
  'team.member_join': 'auditTeamMemberJoin',
  'team.member_remove': 'auditTeamMemberRemove',
  'team.member_role_change': 'auditTeamMemberRoleChange',
  'team.update': 'auditTeamUpdate',
  'team.delete': 'auditTeamDelete',
  'website.create': 'auditWebsiteCreate',
  'website.update': 'auditWebsiteUpdate',
  'website.delete': 'auditWebsiteDelete',
  'website.export': 'auditWebsiteExport',
  'events.export': 'auditWebsiteExport',
  'share.create': 'auditShareCreate',
};

const PROVIDER_LABELS: Record<string, string> = { github: 'GitHub', google: 'Google', sso: 'SSO' };

/** Label for a sign-in method (`password`, `google`, `github`, `sso`). */
export function signInMethodLabel(method: string): string {
  if (method === 'password') return t('authMethodPassword');
  return PROVIDER_LABELS[method] ?? method;
}

export function auditActionLabel(entry: Pick<AuditLogEntry, 'entityType' | 'action'>): string {
  const key = AUDIT_LABEL_KEYS[`${entry.entityType}.${entry.action}`];
  return key ? t(key) : `${entry.entityType} ${entry.action}`;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Short human-readable detail for an entry: sign-in method, 2FA, failure reason, provider,
 * device and names. Unknown metadata is left out rather than dumped as JSON.
 */
export function auditDetail(entry: Pick<AuditLogEntry, 'metadata'>): string {
  const meta = entry.metadata ?? {};
  const parts: string[] = [];

  const method = str(meta.method);
  if (method) parts.push(signInMethodLabel(method));
  if (meta.twoFactor === true) parts.push(t('auditDetailTwoFactor'));

  const reason = str(meta.reason);
  if (reason === 'password') parts.push(t('auditReasonPassword'));
  else if (reason === 'two_factor') parts.push(t('auditReasonTwoFactor'));
  else if (reason) parts.push(reason);

  const provider = str(meta.provider);
  if (provider) parts.push(PROVIDER_LABELS[provider] ?? provider);

  for (const key of ['name', 'username', 'role', 'format'] as const) {
    const value = str(meta[key]);
    if (value) parts.push(value);
  }

  const device = str(meta.device);
  if (device) parts.push(device);

  return parts.join(' · ');
}
