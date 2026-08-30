# Tapasya Constructions

A multi-project management system for a construction company — materials, payments, labor,
equipment, and funding tracked per project, plus a public marketing page per project for
prospective customers. Runs entirely on Cloudflare, in the same style as the sibling
`kids-timetable-worker` project: [Hono](https://hono.dev) instead of Express,
[D1](https://developers.cloudflare.com/d1/) (serverless SQLite), [KV](https://developers.cloudflare.com/kv/)
for sessions, and [R2](https://developers.cloudflare.com/r2/) for photo/document uploads.

Live at **https://tapasyaconstructions.klmn2.com**

## One-time setup (do this once per Cloudflare account)

This Worker is already provisioned (D1 database, KV namespace, and R2 bucket all exist and their
IDs are filled into `wrangler.toml`). Setting it up from scratch on a *different* Cloudflare
account would look like:

```
npm install
npx wrangler login                                          # opens a browser to authorize
npx wrangler d1 create tapasya-constructions                 # copy database_id into wrangler.toml
npx wrangler kv namespace create KV                           # copy id into wrangler.toml
npx wrangler r2 bucket create tapasya-constructions-uploads   # R2 must be enabled on the account first
                                                               # (dash.cloudflare.com -> R2 -> Enable)
npx wrangler d1 migrations apply tapasya-constructions --remote
```

Then set these secrets yourself (so they never pass through a chat/terminal you didn't type
into — run them with the leading `!` in Claude Code so they execute directly, or in any real
terminal):

```
npx wrangler secret put GOOGLE_CLIENT_SECRET   # from Google Cloud Console -> Credentials
npx wrangler secret put RESEND_API_KEY         # from resend.com -> API Keys, powers sign-in emails
```

`GOOGLE_CLIENT_ID`, `PUBLIC_BASE_URL`, and `RESEND_FROM_EMAIL` aren't secret — they're plain `[vars]`
in `wrangler.toml`. This app **reuses the same Google OAuth Client ID as kids-timetable-worker**
(same Client ID → same Client Secret value for both). If you're setting this up somewhere new,
in Google Cloud Console under that OAuth Client's **Authorized redirect URIs**, add:

```
https://<your-domain>/auth/google/callback
```

`RESEND_FROM_EMAIL`'s domain must be verified in the Resend dashboard before sign-in emails will
actually deliver.

## Local development

```
npm run dev
```

This runs `wrangler dev`, which emulates D1, KV, and R2 on your machine — no Cloudflare account
needed to develop and test locally. First run also needs:

```
npm run db:migrate:local
```

To test as a specific role locally, either sign in with Google (you'll land as `viewer` on first
sign-in — promote yourself to `director` via direct D1 access if there's no director yet), or
create a director account through `/api/auth/bootstrap` (only works when the `users` table is
completely empty).

## Deploying (day-to-day)

```
npx wrangler deploy
```

This is a manual/CLI deploy (not auto-deployed from a connected GitHub repo the way
kids-timetable-worker is). Every deploy should be preceded by a quick local `npm run dev` sanity
check.

If a change needs a database schema change, that's a separate explicit step (on purpose, so it's
never accidental):

```
npx wrangler d1 migrations create tapasya-constructions <description>
# edit the generated migrations/xxxx_<description>.sql
npx wrangler d1 migrations apply tapasya-constructions --local    # test locally first
npm run db:migrate:remote
```

### Syncing to GitHub

This project's own git history lives in this folder, but it's also mirrored into the
`srijaan-cloud/self-hosted` GitHub repo under a `tapasyaConstructions/` subdirectory (alongside
`kids-timetable-worker/`), via `git subtree`. That mirror is *not* auto-connected to Cloudflare —
it's a backup/reference copy, not the deploy source. Deploys always come from running
`npx wrangler deploy` directly from this folder.

## Roles & access model

| Role | Access |
|---|---|
| `director` | Full read/write, every project. Only role that can create/delete projects, add staff logins, or edit pricing. |
| `site_supervisor` | Read/write on their assigned project(s), or all projects if given "all projects access." Can't edit pricing or delete a project. |
| `auditor` | Read-only, scoped the same way as site_supervisor. |
| `viewer` | Read-only, public showcase pages only (no financial data at all) — this is the default role for any self-service sign-in, and for anonymous guest browsing. |

**The site is browsable without an account.** Visiting the homepage with no session silently
grants a read-only guest view (same as the `viewer` role) — there's no login wall and no "skip"
button to click. A visible **Login** link in the header leads to the sign-in page (Google OAuth,
open to any account — first sign-in requires a one-time email code to confirm the address — or a
username/password staff login for people without Gmail). A director promotes a self-service
Google sign-in to `site_supervisor`/`auditor`/`director` from Settings → Users; new sign-ins default
to `viewer` and see the public showcase only until promoted.

Staff (director/site_supervisor/auditor) can click **"View as Guest"** in the dashboard header to
see exactly what a real visitor sees (no pricing, no financial data, no edit controls), with a
banner and link back to the normal editable view. This is a client-side display toggle only —
your actual session role and every server-side permission check are completely unaffected by it.

**Logging off** returns you to the same guest view a visitor gets, not the login page — you're
never forced through sign-in just to browse read-only.

## What guests never see

Enforced at the API level (not just hidden in the UI, so it can't be bypassed by calling the
public endpoints directly): payments, material/labor/equipment/funding entries, budgets, and
pricing (`price_per_sqft`, `sold_price_total`). Guests only ever see: project name/city/status,
description, timeline, floor plans, project photos, progress photos, total area, amenities, and
customer reviews.

## Bulk import (Google Sheet or Excel/CSV)

Every project's Materials, Payments, Labor, Equipment, and Funding tabs have an "⇪ Import from
Sheet / Excel" button (director/site_supervisor only). It accepts either:

- A public Google Sheets link (must be shared "Anyone with the link can view"), with an optional
  tab-name field
- An uploaded `.xlsx` or `.csv` file

Columns are matched by header name against a set of common aliases (see `server/import.js`) —
it doesn't need to match the app's own column names exactly. It infers payment mode and category
when a sheet doesn't have those columns, flags ambiguous date formats (assumes DD/MM), and
auto-creates any material type or vendor referenced by name that doesn't exist yet.

Excel parsing uses `exceljs`, not the more common `xlsx`/SheetJS package — the npm-published
SheetJS build has an unpatched high-severity vulnerability (prototype pollution + ReDoS), so it
was deliberately avoided.

## Uploads

Photos and documents (floor plans, project/progress photos, payment receipts, material bills) go
through `/api/uploads` into the R2 bucket, capped at **1MB per file**. Images are compressed
automatically in the browser before upload (resized and re-encoded as JPEG, stepping down
quality/dimensions as needed — see `compressImageIfNeeded` in `public/common.js`), so a normal
phone photo fits under the cap without the user resizing anything manually. PDFs and other
non-image documents can't be auto-compressed and must already be under 1MB.

A project's display/cover photo, plus quick-upload for a floor plan or progress photo, can be set
directly from either "Edit Project" modal (dashboard card, or the project's own page) — full
gallery management (viewing all photos, removing them, picking a different cover) lives on that
project's own "Public Page" tab.

## Notes / things to know

- **Two "Edit Project" modals exist** — one on the dashboard's project card, one on the project's
  own detail page. They edit the same fields; changes made in either show up in the other.
- **Total Budget auto-calculates** as Price/sq.ft × Total Area + Extra Cost as you type, but stays
  a normal editable field if you want to override it manually.
- **Owner phone number(s)** are internal-only (never exposed via the public API), since they're a
  client's personal contact info, not a public enquiry line.
- A payment can link to a specific material/labor/equipment entry (`material_entry_id` /
  `labor_entry_id` / `equipment_entry_id` on the `payments` table) — its `amount_paid` on that
  entry stays in sync automatically. A payment with none of those set is treated as its own
  standalone commitment-and-payment (e.g. a raw imported bank transaction with no separate line
  item), and rolls directly into the dashboard's Committed/Paid totals so it isn't invisible there.
