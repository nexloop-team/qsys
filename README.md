# QueSys

Management system for gaming cafes (PC, PS5) and snooker / 8-ball pool halls:
one live floor, timers, billing, and automatic PC lock/unlock (the PC app in `pc-agent/`).

Stack: Next.js 16 (App Router, Cache Components) + Supabase (Postgres, Auth, RLS, Realtime).

## Setup

1. **Create a Supabase project** (region: Mumbai `ap-south-1` for India).

2. **Add keys.** Copy `.env.example` to `.env.local` and fill in values from
   Supabase → Project Settings → API Keys:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```

   The publishable key is safe in the browser; RLS protects the data.
   Never put the secret key (`sb_secret_...`) in `NEXT_PUBLIC_*` variables.

3. **Create the database tables** (asks for the DB password once; nothing is stored in the repo):

   ```
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```

4. **Auth settings** in Supabase → Authentication → URL Configuration:
   - Site URL: `http://localhost:3000` (your real domain in production)
   - Redirect URLs: `http://localhost:3000/**`

   Email confirmation: either turn it off while testing (Authentication → Providers → Email),
   or set the "Confirm signup" email template link to
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding`.

5. **Regenerate DB types** (replaces the hand-written file). Run in **Git Bash**. PowerShell's `>`
   writes UTF-16, which TypeScript can't read. If the command fails, the redirect leaves an empty file:

   ```
   npx supabase gen types typescript --project-id <project-ref> --schema public > src/lib/database.types.ts
   ```

6. **Run:** `npm run dev` → http://localhost:3000

## Updating the database

Each file in `supabase/migrations` runs once, in order. After pulling new code, apply new migrations with
`npx supabase db push`, or paste each new file into the Supabase SQL editor in filename order.

- `20261103000001_foundation.sql`: cafes, branches, team, stations, pricing
- `20261104000001_sessions_billing.sql`: live sessions, bills, GST, payments, shifts, invites, reports.
  It also turns on Realtime for `sessions`, so the floor updates live on every screen.
- `20261105000001_players_no_shifts.sql`: player accounts (one per mobile number), venue station types,
  and removes shifts (daily totals come from bills).
- `20261106000001_postpaid_layout_reports.sql`: pay at the end for fixed time too (collecting up front is
  optional), floor map positions, and the extra report insights.
- `20261107000001_activity_labels.sql`: the activity log names the item that changed.
- `20261108000001_two_roles.sql`: only Owner and Staff (managers become staff); a venue always keeps one owner.
- `20261109000001_fix_upi_check_gst_default.sql`: fixes saving a UPI ID; "prices include GST" defaults to off.
- `20261110000001_early_end_policy.sql`: owner setting for fixed time stopped early (full booking or time played).
- `20261111…` to `20261115…`: membership hardening, cash/UPI only, expenses, gap fixes, snacks & drinks, player wallets, quick sale.
- `20261116000001_fix_money_paths.sql`: **apply after the 20261115 files.** Fixes wallet payments (they were
  rejected), wallet money taken twice or from the wrong player, snacks billed twice on a double click, snack prices
  sent from the browser, and staff refunds. Reports show snacks and wallet top-ups separately.
- `20261117000001_void_discount_stock_bonus.sql`: cancel a bill (owner), discount reasons + staff discount
  limit, stock counts for snacks & drinks, wallet top-up offers. Apply after `20261116000001`.
- `20261118000001_pc_agent.sql`: the PC app: pairing codes, device keys (stored hashed), the command queue
  (message / restart / shut down / turn on), blocked apps and the lock-screen message. Apply after `20261117000001`.
- `20261119000001_player_pc_login.sql`: players log in on a free PC with mobile + 4-digit PIN (set on the
  player's page), which starts open time in their name. 5 wrong PINs lock the number for 15 minutes. Apply after
  `20261118000001`.
- `20261111000001_memberships_no_direct_insert.sql`: people join a venue only by signing up as owner or with an
  invite code; owners can no longer add an account to their team directly through the API.
- `20261112000001_no_card_payments.sql`: payments are cash or UPI only (old card payments stay on past bills).
- `20261113000001_expenses.sql`: owner-only expenses (rent, bills, salaries linked to a team member), used for
  net profit in Reports.
- `20261114000001_gap_fixes.sql`: players list paging, exact player totals, monthly repeating expenses,
  changing the player count on a live session.

### Password reset emails
"Forgot password" works with Supabase's default email template, as long as the person opens the link in the
same browser they requested it from. To make the link work from any device, edit the **Reset Password**
template (Authentication → Emails) so its link is:
`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/settings/account?reset=1`


## Database tests

pgTAP tests live in `supabase/tests/database`. CI (`.github/workflows/ci.yml`) runs them on a throwaway
local Supabase for every push to `main` and every pull request, along with lint, type-check and build. They run inside a transaction and roll back,
but they do insert test users, so run them against a **development** project, not production:

```
npx supabase test db --linked
```

## Project layout

```
src/app/(auth)        login, signup
src/app/onboarding    create cafe + first branch
src/app/(app)         dashboard (floor), bills, players, reports, expenses, stations, pricing, settings
src/lib/dal.ts        current user / org / role / branch (data access layer)
src/lib/supabase      server + browser clients
src/proxy.ts          session refresh + auth redirects (Next 16 "proxy", formerly middleware)
supabase/migrations   schema, RLS policies, RPCs
pc-agent/             Windows PC app (Tauri 2): lock screen, timer, commands. See pc-agent/README.md
```
