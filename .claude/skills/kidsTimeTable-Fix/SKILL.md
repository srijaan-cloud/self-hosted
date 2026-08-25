---
name: kidsTimeTable-Fix
description: Make a code change to the Kids Timetable Cloudflare Worker app end-to-end — clone fresh from GitHub into a new folder, make the change, test it, deploy to Cloudflare, then commit and push back to GitHub. Use whenever asked to fix, change, or add something in the Kids Timetable app.
---

# Kids Timetable — Fix & Ship

Always start from a fresh clone of the GitHub repo (the source of truth) — never reuse
or assume the state of any existing local checkout. This keeps every change working
from exactly what's live on GitHub, with nothing stale or half-edited from a previous
session carried forward by accident.

## Facts about this project

- Source of truth: `git@github.com:srijaan-cloud/self-hosted.git`, branch `main`
- The app lives in the `kids-timetable-worker/` subdirectory of that repo (a monorepo
  of several self-hosted projects, so clone the whole thing, then work inside that
  subdirectory)
- Live site: `https://kidstimetable.klmn2.com`
- Cloudflare Worker name: `kids-timetable`
- Stack: Hono (server/), D1 (SQLite), KV (sessions), plain HTML/CSS/JS frontend (public/)
- Cloudflare auth (`wrangler login`) is machine-global, not tied to any one clone, so
  `wrangler deploy` works fine from a brand-new folder without re-authenticating.

## Steps

1. **Clone fresh into a new, timestamped folder** — don't touch or reuse
   `~/Sowjanya/Projects/kids-timetable-worker` (that's a separate, disconnected local
   checkout used for manual day-to-day dev; leave it alone).
   ```
   mkdir -p ~/Sowjanya/Projects/kids-timetable-fixes
   cd ~/Sowjanya/Projects/kids-timetable-fixes
   git clone git@github.com:srijaan-cloud/self-hosted.git kidstimetable-fix-$(date +%Y%m%d-%H%M%S)
   cd kidstimetable-fix-<the folder just created>/kids-timetable-worker
   ```

2. **Install dependencies:**
   ```
   npm install
   ```

3. **Make the requested change.** Read the existing code first — `server/` (Hono
   backend: `index.js` routes, `auth.js` auth/roles/OTP, `oauth.js` Google sign-in,
   `db.js`/`session.js`/`points.js`) or `public/` (frontend: `app.js` the main app,
   `login.js`/`login.html` the login page, `index.html`, `style.css`). Match existing
   conventions rather than guessing.

4. **Test locally** before shipping, for anything beyond a trivial copy/CSS tweak:
   ```
   npm run dev
   ```
   If the change adds or alters a DB migration, apply it locally first:
   ```
   npm run db:migrate:local
   ```
   Stop the dev server (`pkill -f "wrangler dev"`) before deploying.

5. **Deploy to Cloudflare:**
   ```
   npx wrangler deploy
   ```
   If there's a new migration, apply it to production too — separate, deliberate step:
   ```
   npm run db:migrate:remote
   ```

6. **Verify** the live site actually reflects the change (curl the relevant endpoint,
   or describe what to check) before calling it done.

7. **Commit and push back to GitHub.** This clone is a normal checkout of the whole
   monorepo, so it's a plain commit and push — no subtree juggling needed:
   ```
   git add -A
   git commit -m "<describe what changed and why>"
   git push origin main
   ```

## Notes

- Secrets (`GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`) live only in Cloudflare
  (`wrangler secret put`) — never in this repo, never something this skill touches.
- A new DB migration should always be created explicitly, never by editing an
  existing migration file:
  ```
  npx wrangler d1 migrations create kids-timetable <description>
  ```
- Old fix-clones under `~/Sowjanya/Projects/kids-timetable-fixes/` are disposable —
  safe to delete once a change is confirmed live.
- Destructive or production-affecting steps (force-push, dropping data, disabling
  auth) still need explicit user confirmation first, same as any other work in this
  project — this skill automates the routine path, not a blank check for risky moves.
