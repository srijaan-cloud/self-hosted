# HostNMaintain

KLMN2's own marketing site: explains that we design, host, and maintain client websites,
and lets a prospective client send us their requirements. Runs entirely on Cloudflare, in the
same style as the sibling `tapasyaConstructions` and `kids-timetable-worker` projects:
[Hono](https://hono.dev), [D1](https://developers.cloudflare.com/d1/) (serverless SQLite) for
storing enquiries.

Will be live at **https://hostnmaintain.klmn2.com** once deployed and the custom domain route
is added in the Cloudflare dashboard for this zone.

Unlike the other two apps, there's no login system for visitors — the whole site is public
marketing content plus a contact form. The only protected page is `/admin.html` (and its
`/api/leads` endpoint), gated by a single shared HTTP Basic Auth password (`ADMIN_PASSWORD`) —
overkill to build a full multi-user role system for what is, for now, a one-person inbox.

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

Finally, add the custom domain route in the Cloudflare dashboard (Workers & Pages → this
Worker → Settings → Domains & Routes → Add → `hostnmaintain.klmn2.com`) the same way the other
two subdomains were added — `wrangler.toml` already declares the route, but Cloudflare still
needs the DNS record created for a brand-new subdomain the first time.

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

- **Hero, What We Do, Process, Why Host With Us** — explains the design → host → maintain
  service in plain terms.
- **Clients** — showcases live client work; currently just `tapasyaConstructions.klmn2.com`
  (the only real external client so far — `kids-timetable-worker` is an internal/personal
  project, not a client deliverable, so it's intentionally not listed here). Add more
  `.client-card` entries in `public/index.html` as new clients go live.
- **Contact form** (`POST /api/contact`) — saves every enquiry to the `leads` table in D1 and
  (if `RESEND_API_KEY` is set) emails a notification to `ADMIN_NOTIFY_EMAIL`. Includes a hidden
  honeypot field to quietly drop bot submissions.
- **`/admin.html`** — a simple, Basic-Auth-protected list of everything in `leads`, newest first.

## Notes / things to know

- No `KV` or `R2` bindings — this site doesn't need sessions (no login) or file uploads.
- The `www.` prefix was deliberately dropped from the subdomain — neither sibling app uses it,
  and it would have needed its own DNS route.
