# SSO

External systems can sign users in without a password by exchanging a short-lived HMAC token.

## Setup

Set `SSO_SECRET` on the API worker (separate from `APP_SECRET`):

```bash
cd apps/api
wrangler secret put SSO_SECRET --env production
```

## Mint a token

Use `@flareboard/shared`:

```ts
import { createSsoToken } from '@flareboard/shared';

const token = createSsoToken({ userId, role }, SSO_SECRET);
```

Tokens expire in 5 minutes.

## Exchange for JWT

```bash
curl -X POST https://api.your-domain.com/api/auth/sso \
  -H 'Content-Type: application/json' \
  -d '{"token":"<token>"}'
```

Response shape matches `/api/auth/login`: `{ token, user }`.
