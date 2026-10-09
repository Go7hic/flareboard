---
title: Teams and access
description: Share websites with other people in Flareboard. Roles and what each can do, joining with an access code, team-owned websites, requiring two-factor authentication, and removing members.
---

A team lets several people work on the same websites. Team websites, boards, links and pixels are shared with every member, and each member's role decides whether they can change things or only look.

## Before you start

- On Flareboard Cloud, teams need the Cloud or Business plan. The **Create team** and **Join team** buttons are disabled on the Free plan, and the console says "Teams are available on the Cloud plan." The check is made on your own account, so a person joining a team needs a Cloud or Business plan too. See [Plans and limits](/docs/plans-limits).
- Self-hosted installs have teams without plan limits.

## Roles

A team has four roles. The role names below are the ones the console shows.

| Role | In the API | Can do |
| --- | --- | --- |
| **Owner** | `team-owner` | Everything a Manager can do, plus change other owners' roles, remove owners, require two-factor authentication and delete the team (deleting is available through the API only). |
| **Manager** | `team-manager` | Everything a Member can do, plus add websites to the team, see the access code, change members' roles (except to or from Owner) and remove members, and read the team activity log. |
| **Member** | `team-member` | View the team's websites and analytics, and change them: settings, feature flags, experiments, boards, goals and other configuration. Members can also delete a team website. |
| **Read-only** | `team-view-only` | View the team's websites and analytics. Cannot change anything. |

A person who joins with the access code starts as **Read-only**. An Owner or Manager changes the role afterwards.

A team always has at least one Owner. The last Owner cannot be demoted or removed. Only an Owner can make someone an Owner, or change or remove an existing one.

A person's own account can also be read-only, which is a global setting (the `view-only` role). It overrides a team role. A read-only account cannot change team websites even as an Owner.

## 1. Create a team

1. In the console, open **Teams** and click **Create team**.
2. Enter a **Team name** and click **Create**.

You become the team's **Owner**.

## 2. Add people

Flareboard does not send email invitations. People join with the team's access code:

1. As an Owner or Manager, open **Teams** and select the team. Under **Access code**, click the copy button.
2. Send the code to your teammate over a private channel. Anyone who has it can join the team as **Read-only**.
3. Your teammate signs in, opens **Teams**, clicks **Join team**, pastes the code into **Access code** in the dialog **Join with access code**, and clicks **Join team**.
4. In the team's **Members** table, change their **Role** from the dropdown.

The code is eight characters. Joining is limited to 10 attempts a minute per IP address. The console has no way to change a team's code, so remove members you no longer want in the **Members** table.

## 3. Add team websites

A website belongs either to one person or to a team. To create one that belongs to a team:

1. Open **Teams** and select the team.
2. Under **Websites**, click **Add website**. This is available to Owners and Managers.
3. Enter a **Name** and **Domain**, and click **Create website**.

Flareboard opens the new website's settings with its install snippet. Every member of the team can see the website from then on. See the [Quickstart](/docs/quickstart) for installing the script.

A team website keeps the account that created it as its owner for billing purposes. The plan and features of that account decide what the website can use, and its events count against that account's monthly allowance. Members use the website under that plan. So the person who creates team websites should be the one whose plan you want to use. If that account is deleted, the website moves to another Owner or Manager of the team, one on a paid plan first, and keeps collecting under their plan and allowance. Usage counted before the move stays with the deleted account. See [Plans and limits](/docs/plans-limits).

There is no move or transfer action for websites. A website created under a personal account stays personal, and one created in a team stays in the team. To get a website into a team, create it there and install the new website ID.

Team **Links & Pixels** are shared the same way. Open the team and click **Links & Pixels**.

## Require two-factor authentication

Owners can require every member to use two-factor authentication:

1. Turn on two-factor authentication for your own account first, under **Security** in the account menu. See [Account security](/docs/security).
2. Open **Teams** and select the team. Under **Security**, switch on **Require two-factor authentication**.

From then on, a member without two-factor authentication loses access to the team's websites until they turn it on. Once the requirement is on, and always for Owners, the team shows a **Members with 2FA** count and the **Members** table has a **Two-factor** column with **On** or **No 2FA** for each person. Affected members see a notice saying the team requires two-factor authentication and asking them to set it up.

An Owner of a team that requires two-factor authentication cannot turn it off on their own account until the requirement is lifted. Other members (Managers, Members and Read-only) can see that the requirement is on but cannot change it.

## Remove members and leave

- **Remove a member.** In the **Members** table, click **Remove** next to the person and confirm. They lose access to the team's websites right away. Owners and Managers can do this, and only Owners can remove an Owner.
- **Leave a team.** An Owner or Manager can remove themselves the same way. The last Owner cannot leave until someone else is an Owner. A Member or Read-only person has no button for this in the console, so ask an Owner or Manager to remove you. The API also lets any member remove themselves with `DELETE /api/teams/TEAM_ID/users/YOUR_USER_ID`.
- **Websites a person created.** If you remove someone from the team, they lose access to the team websites they created. The websites stay with the team.
- **Deleting an account.** When you delete your own account, your personal websites are deleted and websites that belong to a team stay with the team. Team websites billed to you move to another Owner or Manager, one on a paid plan first. If you are the only Owner of a team that has other members, the console asks you to make another member an Owner first. If you are the only member, the team and its websites are deleted with your account. See [Account security](/docs/security#delete-your-account).

## Team activity

Owners and Managers see **Team activity** in the team. It lists members joining, removals, role changes, setting changes and website changes, with who made each. Your own sign-ins and security changes are in your [account activity](/docs/security#account-activity).

## Troubleshooting

- **Create team and Join team are greyed out.** Your account is on the Free plan. Upgrade on the **Billing** page.
- **"Team not found" when joining.** The access code is wrong or has a typo. Ask an Owner or Manager to copy it again from **Access code**.
- **A member cannot see the team's websites.** The team may require two-factor authentication and the member has not turned it on, or they have been removed.
- **A member cannot change a setting.** Their role is **Read-only**. An Owner or Manager can change it in the **Members** table.
