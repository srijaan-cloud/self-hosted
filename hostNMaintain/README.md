# HostNMaintain

KLMN2's own marketing site: explains that we design, host, and maintain client websites,
and lets a prospective client send us their requirements. Runs entirely on Cloudflare, in the
same style as the sibling `tapasyaConstructions` and `kids-timetable-worker` projects:
[Hono](https://hono.dev), [D1](https://developers.cloudflare.com/d1/) (serverless SQLite) for
storing enquiries.

Live at **https://hostnmaintain.klmn2.com**.

Unlike the other two apps, there's no login system for visitors — the whole site is public
marketing content plus a contact form. The only protected page is `/admin.html` (and its
`/api/leads` and `/api/settings/site-content` endpoints), gated by a single shared HTTP Basic
Auth password (`ADMIN_PASSWORD`) by default — overkill to build a full multi-user role system
for what is a one-person inbox. An optional Google sign-in (see below) can be turned on as an
alternate way in, on top of Basic Auth rather than instead of it.

## One-time setup (do this once per Cloudflare account)

The D1 database (`hostnmaintain`) already exists and its `database_id` is filled into
`wrangler.toml`. What's still needed before this can go live:

```
npm install
npx wrangler d1 migrations apply hostnmaintain --remote
```

Then set these secrets yourself (run with a leading `!` in Claude Code so they execute
directly, or in any real terminal — never paste secret values into chat):

```
npx wrangler secret put RESEND_API_KEY    # from resend.com -> API Keys, powers lead-notification emails
npx wrangler secret put ADMIN_PASSWORD    # your own choice — protects /admin.html and /api/leads
```

`RESEND_FROM_EMAIL`'s domain (`klmn2.com`) is already verified in Resend from the sibling
projects, so no extra Resend setup is needed beyond the API key.

`npx wrangler deploy` provisions the custom domain automatically from the `[[routes]]` block in
`wrangler.toml` — no manual DNS step needed, even the first time.

### Optional: Google sign-in for admin

Off by default — Basic Auth alone is enough to run this site. To turn on "Sign in with Google"
as an alternate way into `/admin.html` (toggled from Site Content → Access once deployed):

```
npx wrangler secret put GOOGLE_CLIENT_SECRET   # same value used for tapasyaConstructions/kids-timetable-worker
```

Then, in Google Cloud Console, under that same OAuth Client's **Authorized redirect URIs**, add:

```
https://hostnmaintain.klmn2.com/auth/google/callback
```

Only the address in `ADMIN_EMAIL` (`wrangler.toml`) can actually sign in this way — it's an
allowlist of one, not a real user system, so a mismatched Google account is rejected outright.
Until the toggle is switched on in Site Content, `/auth/google` just redirects back to
`/login.html?error=disabled` even if someone hits it directly.

## Local development

```
npm run dev
```

This runs `wrangler dev`, which emulates D1 locally — no Cloudflare account needed to develop.
First run also needs:

```
npm run db:migrate:local
```

Create a `.dev.vars` file (gitignored) with `ADMIN_PASSWORD=<anything>` to test the `/admin.html`
lead inbox locally. Without `RESEND_API_KEY` set, contact form submissions still save to D1 —
they just skip the email notification.

## Deploying (day-to-day)

```
npx wrangler deploy
```

Manual/CLI deploy, same as `tapasyaConstructions` — not auto-deployed from GitHub. Every deploy
should be preceded by a quick local `npm run dev` sanity check.

A database schema change is a separate explicit step:

```
npx wrangler d1 migrations create hostnmaintain <description>
# edit the generated migrations/xxxx_<description>.sql
npx wrangler d1 migrations apply hostnmaintain --local    # test locally first
npm run db:migrate:remote
```

## What's on the page

- **Hero, What We Do, Process, Why Host With Us, Clients, Contact** — every heading, card,
  step, and list on the page is admin-editable (see below), not hardcoded — the HTML just holds
  the same copy as the defaults in `server/index.js` so the page still looks right before
  JavaScript runs or if the content fetch ever fails.
- **Clients** — currently just `tapasyaConstructions.klmn2.com` (the only real external client
  so far — `kids-timetable-worker` is an internal/personal project, not a client deliverable, so
  it's intentionally not listed). Add more from Site Content → Clients → **+ Add Client** as new
  clients go live; Tapasya keeps its hand-drawn construction icon, new entries get an initials
  badge.
- **Contact form** (`POST /api/contact`) — saves every enquiry to the `leads` table in D1 and
  (if `RESEND_API_KEY` is set) emails a notification to `ADMIN_NOTIFY_EMAIL`. Includes a hidden
  honeypot field to quietly drop bot submissions.
- **`/admin.html`** — two tabs: **Leads** (everything in the `leads` table, newest first) and
  **Site Content** (edit every piece of copy above, plus the Google-login toggle). Protected by
  Basic Auth, or Google sign-in if turned on (see above).

## Notes / things to know

- Content edits take effect immediately (no redeploy) — `GET /api/site-content` is public,
  `PUT /api/settings/site-content` is admin-only, both backed by a single `site_content` row in
  D1 (see `migrations/0002_site_content.sql`).
- The `www.` prefix was deliberately dropped from the subdomain — neither sibling app uses it,
  and it would have needed its own DNS route.
