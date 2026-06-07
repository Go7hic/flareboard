# Security Policy

## Reporting a Vulnerability

If you discover a security issue, please report it responsibly rather than opening a public issue.

Email the maintainers with a description of the vulnerability, steps to reproduce, and any suggested fix. We will acknowledge receipt and work on a remediation plan.

## Supported Versions

Security fixes are applied to the latest release on the default branch.

## Production Checklist

- Set a strong, unique `APP_SECRET` on both API and ingest workers (never use `flareboard-dev-secret`).
- Set `SSO_SECRET` if SSO is enabled; do not rely on `APP_SECRET` for SSO in production.
- Replace all `REPLACE_WITH_*` placeholders in wrangler production configs before deploy.
- Change the default seeded admin password immediately after first login.
