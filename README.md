# Kids Timetable (Cloudflare Worker edition)

A points tracker for Lahari (8th grade) and NagaSourish (5th grade), protected by a site-wide
login (family password, Touch ID, Google, or an emailed sign-in code), running entirely on
Cloudflare — no dependency on any specific Mac being on.

This is a from-scratch rewrite of the original Mac/Express app (`../TimeTable`) for Cloudflare
Workers: [Hono](https://hono.dev) instead of Express, [D1](https://developers.cloudflare.com/d1/)
(serverless SQLite) instead of a local file, and [KV](https://developers.cloudflare.com/kv/) for
sessions instead of `express-session`.

## One-time setup (do this once per Cloudflare account)

```
npm install
npx wrangler login                                   # opens a browser to authorize
npx wrangler d1 create kids-timetable                 # copy the returned database_id into wrangler.toml
npx wrangler kv namespace create KV                   # copy the returned id into wrangler.toml
npx wrangler d1 migrations apply kids-timetable --remote
```

Then set these secrets yourself (so they never pass through a chat/terminal you didn't type
into):

```
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put RESEND_API_KEY      # powers the email sign-in code, from resend.com
```

`GOOGLE_CLIENT_ID`, `ADMIN_EMAIL`, and `RESEND_FROM_EMAIL` aren't secret — set them as plain vars
in `wrangler.toml` or in the Cloudflare dashboard (Workers & Pages → this Worker → Settings →
Variables). `RESEND_FROM_EMAIL`'s domain must be verified in the Resend dashboard before sign-in
emails will actually deliver.

(Facebook sign-in was removed for now. Re-adding it later means rebuilding
`facebookAuthStart`/`facebookAuthCallback` in `server/oauth.js` — a plain OAuth2 dialog against
`graph.facebook.com`, no OIDC discovery available — plus `FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET`
and the login button back in `public/login.html`.)

## Local development

```
npm run dev
```

This runs `wrangler dev`, which fully emulates D1 and KV on your machine — no Cloudflare account
needed to develop and test locally. First run also needs:

```
npm run db:migrate:local
```

## Deploying (day-to-day)

Once the GitHub repo is connected to this Worker in the Cloudflare dashboard (Workers & Pages →
Create → Connect to Git), the workflow for any future fix is:

1. Clone the repo (any machine), make the change.
2. Test with `npm run dev` locally.
3. `git push`.
4. Cloudflare automatically builds and deploys — typically live within about a minute. No SSH,
   no server to restart, nothing tied to any particular computer.
5. If a deploy is bad, roll back instantly from the Cloudflare dashboard's deployment history.

If a change needs a database schema change, that's a separate explicit step (on purpose, so it's
never accidental):

```
npx wrangler d1 migrations create kids-timetable <description>
# edit the generated migrations/xxxx_<description>.sql
npm run db:migrate:remote
```

## Signing in

Nothing in the app — not even viewing the checklist — is reachable without signing in first, via:

- **Family password** — set on first visit.
- **Touch ID** — once registered from Settings (tied to the domain you're on; if you ever change
  domains, previously-registered devices need to be re-added).
- **Google** — open to any account, no allowlist.
- **Email sign-in code** — enter any email, get a 6-digit code sent to it via Resend, no account
  needed.

Any of these gets you into the app. But only admins can actually save changes — starting with the
one address in the `ADMIN_EMAIL` environment variable (editable directly in the Cloudflare
dashboard, no redeploy needed; a permanent admin that can't be demoted) plus anyone who signs in
with the family password or Touch ID, since those have no identity of their own. Existing admins
can grant or remove admin access for anyone else from Profile → Users, once that person has signed
in at least once. Everyone else sees the tracker read-only. Saving itself needs no extra
verification beyond being signed in as an admin.

**Forgot the family password?** Click "Forgot password?" on the login screen. This only works for
`ADMIN_EMAIL` (a code is emailed to it, then it sets a new password) — deliberately restricted, so
resetting the shared password can't become a way for a non-admin viewer to grant themselves write
access.

## Notes on the migration from the Mac version

- Historical points data (`children`, `entries`) was carried over via `scripts/seed-existing-data.sql`.
- The family password and any registered Touch ID devices were **not** carried over — password
  hashing moved from Node's `scrypt` to Web Crypto's `PBKDF2` (portable across runtimes), and
  Touch ID is tied to the domain it was registered from. Set the password again and re-register
  Touch ID once, the same as a first-time setup.
