---
title: Account security
description: Change your password, turn on two-factor authentication, link GitHub or Google sign-in, sign out other devices, read your account activity and delete your account.
---

Your Flareboard account has its own security page. It covers your password, two-factor authentication, the accounts you can sign in with, the devices that are signed in, and a log of what happened on your account.

To open it, open the account menu (your name at the bottom of the sidebar) and choose **Security**.

## Password

The **Password** card changes the password you sign in with.

1. Enter your **Current password**.
2. Enter a **New password** (at least 8 characters) and repeat it in **Confirm new password**.
3. Click **Change password**.

Changing your password signs out every other device. This device stays signed in.

If you forgot your password, use **Forgot password?** on the sign-in page. The reset link is emailed to the address on your account. Resetting signs out every device and does not turn off two-factor authentication.

Accounts that were created with GitHub or Google have no password until you set one. For those accounts the **Password** card is not shown. To set a password, use **Forgot password?** on the sign-in page; the link goes to the email address on the account. You do not need a password to sign in with your provider.

## Two-factor authentication

Two-factor authentication asks for a 6-digit code from an authenticator app each time you sign in, in addition to your password or provider sign-in. It works with any app that supports standard time-based codes (6 digits, 30-second steps), such as 1Password, Google Authenticator or Authy.

### Turn it on

1. On the **Security** page, find **Two-factor authentication** and click **Set up two-factor authentication**.
2. Scan the QR code with your authenticator app. If you cannot scan it, use **Can’t scan? Enter this key instead**.
3. Enter the 6-digit code from the app in **Authentication code** and click **Turn on**.
4. Flareboard shows your recovery codes. Click **Copy all** or **Download .txt**, store them somewhere safe, and click **I saved them**.

You get 10 recovery codes. Each one signs you in once if you lose your authenticator. They are shown only now. Flareboard stores them as one-way hashes and cannot show them again. The secret behind your authenticator app is stored encrypted.

### Sign in with it

After your password (or your GitHub or Google sign-in), enter the 6-digit code and click **Verify**. If you lost your authenticator, click **Use a recovery code** and enter one of your recovery codes instead. After too many wrong codes, sign-in is locked for a while and shows "Too many attempts. Try again later."

### Recovery codes

The card shows **Recovery codes left** and warns when you are running low. Click **Regenerate recovery codes** to get a new set of 10. Enter a code to confirm. Your old codes stop working at once.

### Turn it off

Click **Turn off**. Flareboard asks for your password (if your account has one) and a current code. Without two-factor authentication, signing in needs only your password again. If you are an owner of a team that requires two-factor authentication, you cannot turn it off until you turn off the team's requirement. See [Teams and access](/docs/teams).

Turning two-factor authentication off deletes your secret and recovery codes.

## Sign-in methods

The **Sign-in methods** card lists GitHub and Google, the other accounts that can sign in to your Flareboard account. It shows a provider only if your install has it turned on or you already linked it. Each row shows the **Status** (**Linked** or **Not linked**) and when it was linked.

### Link a provider

1. Click **Link** next to the provider. You can also choose **Link GitHub account** or **Link Google account** in the account menu.
2. Approve access on the provider's page.
3. You return to the **Security** page with a notice that the provider is linked. You can now sign in with it.

Flareboard stores the provider's account identifier and the email or username it returns, not its access tokens. A provider account can be linked to one Flareboard account at a time. Linking one that belongs to another Flareboard user is refused.

If you sign in with a provider that is not linked, Flareboard connects it to an existing account only when the provider and Flareboard have both verified the same email address. If no account matches, Flareboard Cloud creates a new account for the provider. A self-hosted install shows an error instead and asks you to sign in with your password and link the provider from the account menu.

### Unlink a provider

1. Click **Unlink** next to the provider and confirm.
2. You can no longer sign in with that provider account. You can link it again at any time.

Flareboard refuses to unlink your only way to sign in. If the account was created with that provider and has no password, set a password first with **Forgot password?** on the sign-in page, then unlink it.

## Signed-in devices

The **Signed-in devices** card lists the browsers that are signed in to your account. Each row shows the **Device**, how you signed in (**Signed in with**), when (**Signed in**) and when it was last used (**Last active**). The device is a short label such as "Chrome on macOS". Flareboard does not store IP addresses or the raw user agent. Your current browser is marked **This device**.

- Click **Sign out** on a row to end that session. That device must sign in again.
- Click **Sign out all other devices** to end every session except this one.

A session lasts 7 days after it was last renewed. Changing your password also ends every other session. If you see a device you do not recognize, sign it out, change your password and check [Account activity](#account-activity).

## Account activity

The **Account activity** card is a log of what happened on your account, newest first. It records:

- sign-ins and failed sign-in attempts, with the sign-in method and a short device label;
- password changes and password resets;
- two-factor changes, such as turning it on or off, regenerating recovery codes and using a recovery code;
- signing out one device or all other devices;
- creating and revoking API keys;
- linking and unlinking sign-in providers;
- team and website actions, such as creating or deleting a website, exporting data and creating share links.

It does not record IP addresses. The card shows the latest 50 entries. Records of sign-ins and failed sign-ins are deleted after 180 days. Other entries are kept as long as your account exists. Team owners and managers also see a separate [team activity](/docs/teams#team-activity) log.

## API keys

Personal API keys let scripts and AI tools act as you. Create and revoke them under **API keys** in the account menu. A key cannot create other keys, change your password, manage two-factor authentication, sessions or sign-in methods, or delete your account. Those need you signed in to the console. See [REST API](/docs/api#authentication) and the [MCP server](/docs/mcp).

## Delete your account

You can delete your account yourself.

1. Open the account menu and choose **Delete account…**.
2. Type your username where the box reads "Type YOUR_USERNAME to confirm" (with your own username). If your account has a password, enter it too.
3. Click **Delete account**.

What happens:

- You are signed out everywhere, your API keys stop working, and any paid subscription is cancelled.
- Your account is closed right away. Your personal websites, their analytics data, your boards and your links are deleted. Websites that belong to a team stay with the team.
- Everything is permanently erased after a grace period of 30 days. That includes your sessions, API keys, two-factor secret and recovery codes, linked sign-in providers, saved insights, reports and report subscriptions, assistant conversations and your account record. Billing records are kept as long as tax and accounting law requires, generally seven years. See [Privacy and data](/docs/privacy-data).
- Until the 30 days pass, the data still exists. If you deleted by mistake, email [support@flareboard.dev](mailto:support@flareboard.dev) straight away.

Flareboard blocks deletion in these cases:

- You are the only owner of a team that has other members. The message reads "Make another member an owner of TEAM before deleting your account." Make someone else an owner first. If you are the only member, the team and its websites are deleted with your account.
- On a self-hosted install, you are the only account with the global admin role. Make another user an admin first.
- Flareboard cannot cancel your subscription. Nothing changes, so you can try again or contact support.

To delete one website without the account, use **Delete website** in its settings. The same 30-day period applies.

## Troubleshooting

- **I lost my authenticator.** Sign in with a recovery code, then turn two-factor authentication off and set it up again, or regenerate recovery codes.
- **I lost my authenticator and my recovery codes.** Flareboard cannot show recovery codes again. Contact [support@flareboard.dev](mailto:support@flareboard.dev).
- **The code is rejected.** The code in the app changes every 30 seconds. Check that your phone's clock is set automatically, and enter the current code.
- **I cannot unlink GitHub.** It is your only way in. Set a password with **Forgot password?** first.
