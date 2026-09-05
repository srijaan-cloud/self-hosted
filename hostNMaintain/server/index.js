import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import * as oauth from './oauth.js';
import * as auth from './auth.js';
import { sessionMiddleware, destroySession } from './session.js';

const app = new Hono();

// Single admin, two ways in: the Basic Auth password (always available), or
// Google sign-in + an emailed OTP (server/oauth.js, server/auth.js) —
// optional, toggled from Site Content → Access. Matching ADMIN_EMAIL in the
// Google account alone only triggers the OTP email; it doesn't grant access
// by itself (see /api/auth/verify-otp below). No role system needed since
// there's only ever one kind of logged-in user here.
function requireAdmin(c, next) {
  const session = c.get('session');
  if (session && session.isAdmin) return next();
  return basicAuth({ username: 'admin', password: c.env.ADMIN_PASSWORD })(c, next);
}

app.use('/admin.html', sessionMiddleware, requireAdmin);
app.use('/api/leads', sessionMiddleware, requireAdmin);
app.use('/api/settings/site-content', sessionMiddleware, requireAdmin);
app.use('/api/users', sessionMiddleware, requireAdmin);
app.use('/auth/*', sessionMiddleware);
app.use('/api/auth/*', sessionMiddleware);

app.get('/api/users', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT email, name, role, first_login_at, last_login_at FROM users ORDER BY last_login_at DESC`
  ).all();
  return c.json({ users: results });
});

app.get('/auth/google', oauth.googleAuthStart);
app.get('/auth/google/callback', oauth.googleAuthCallback);
app.get('/auth/logout', (c) => {
  destroySession(c);
  return c.redirect('/');
});

app.post('/api/auth/verify-otp', async (c) => {
  const session = c.get('session');
  const email = session.pendingAdminEmail;
  if (!email) return c.json({ error: 'Nothing to verify — sign in with Google again' }, 400);
  const { code } = await c.req.json();
  const ok = await auth.verifyOtp(c.env, email, String(code || '').trim());
  if (!ok) return c.json({ error: 'Incorrect or expired code' }, 400);
  session.pendingAdminEmail = null;
  session.isAdmin = true;
  session.email = email;
  return c.json({ ok: true });
});

app.get('/api/auth/me', (c) => {
  const session = c.get('session');
  if (!session.name) return c.json({ loggedIn: false });
  return c.json({ loggedIn: true, name: session.name, email: session.email, isAdmin: !!session.isAdmin });
});

app.post('/api/auth/resend-otp', async (c) => {
  const email = c.get('session').pendingAdminEmail;
  if (!email) return c.json({ error: 'Nothing to verify — sign in with Google again' }, 400);
  try {
    await auth.requestOtp(c.env, email);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err.message }, 400);
  }
});

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------- Site content (admin-editable marketing copy) ----------
// One JSON blob in a singleton D1 row, same pattern as
// tapasyaConstructions/migrations/0011_site_content.sql. List-shaped fields
// (cards, steps, features, clients) use simple " :: "-delimited lines rather
// than a nested add/remove-row UI, so the whole page can be rewritten from a
// handful of textareas in /admin.html.
const DEFAULT_SITE_CONTENT = {
  // Off by default: the site works fully (including admin access via Basic
  // Auth) without Google login ever being configured or turned on.
  google_login_enabled: false,
  eyebrow: 'KLMN2 · Website Design, Hosting & Care',
  headline_main: 'We turn your idea into a live website —',
  headline_accent: 'and keep it that way.',
  hero_sub: "Tell us what you need. We design it, publish it on our own klmn2.com infrastructure, and stay on to maintain it — so you never have to think about servers, uptime, or updates.",
  trust_pills: `🌐 Cloudflare global network
⚡ Live in days, not months
🛠️ Maintenance included`,
  what_heading: 'From a conversation to a live, maintained website',
  what_cards: `💬 :: Understand :: We start by listening — your business, your customers, and what the site actually needs to do for you.
🎨 :: Design :: A clean, custom design built around your brand — never a generic template stretched to fit.
🚀 :: Host & Publish :: Deployed to your own subdomain on klmn2.com, served fast to every visitor on Cloudflare's global edge network.
🛠️ :: Maintain :: We don't disappear after launch. We keep the site running, updated, and evolving with your requirements.`,
  process_heading: 'Four steps, one point of contact the whole way',
  process_steps: `Discovery Call :: We talk through what you're building, who it's for, and what "done" looks like.
Design & Build :: We design and build your site end-to-end, checking in as it takes shape.
Go Live :: Your site launches on a klmn2.com subdomain — secured, fast, and available to everyone.
Ongoing Care :: We monitor it, fix what needs fixing, and add to it whenever your requirements change.`,
  features_heading: 'Everything after launch, handled',
  features: `🌐 :: Global Edge Network :: Hosted on Cloudflare's infrastructure — fast for every visitor, wherever they are.
🔒 :: Secure by Default :: HTTPS everywhere, modern infrastructure, no plugins sitting around unpatched.
🧭 :: One Point of Contact :: You talk directly to the person building your site — no ticket queues, no hand-offs.
🎯 :: Custom, Not Templated :: Every site is designed around your actual business, not a theme with your logo dropped in.
🧩 :: Built to Grow :: Add pages, features, or a client portal any time your requirements change — we build for that.
🛎️ :: Maintenance Included :: Launch day isn't the finish line — we keep maintaining the site for as long as you need us.`,
  clients_heading: "Who we've built for",
  clients_sub: "A look at sites we've designed, hosted, and continue to maintain on klmn2.com.",
  clients: `Tapasya Constructions :: A construction company's full project & accounts management system — budgets, materials, and payments internally, plus a public showcase site for prospective customers — live on their own klmn2.com subdomain. :: https://tapasyaconstructions.klmn2.com`,
  contact_heading: "Tell us what you're building",
  contact_sub: "Fill this in and we'll get back to you personally — no auto-replies, no sales team.",
  footer_text: '© 2026 KLMN2 · Designed, hosted, and maintained on Cloudflare',
};

async function getSiteContent(env) {
  const row = await env.DB.prepare('SELECT data FROM site_content WHERE id = 1').first();
  const stored = row ? JSON.parse(row.data) : {};
  return { ...DEFAULT_SITE_CONTENT, ...stored };
}

app.get('/api/site-content', async (c) => {
  return c.json(await getSiteContent(c.env));
});

app.put('/api/settings/site-content', async (c) => {
  const body = await c.req.json();
  const merged = { ...(await getSiteContent(c.env)), ...body };
  await c.env.DB.prepare(
    `INSERT INTO site_content (id, data, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP`
  ).bind(JSON.stringify(merged)).run();
  return c.json(merged);
});

app.post('/api/contact', async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  // Honeypot field: real visitors never see or fill it (hidden via CSS), so
  // any submission with it filled in is a bot. Return success anyway so the
  // bot doesn't learn to leave it blank next time.
  if (body.website) return c.json({ ok: true });

  const name = String(body.name || '').trim().slice(0, 200);
  const email = String(body.email || '').trim().slice(0, 200);
  const phone = String(body.phone || '').trim().slice(0, 60);
  const company = String(body.company || '').trim().slice(0, 200);
  const budget = String(body.budget || '').trim().slice(0, 100);
  const message = String(body.message || '').trim().slice(0, 4000);

  if (!name || !email || !message) return c.json({ error: 'missing_fields' }, 400);
  if (!isValidEmail(email)) return c.json({ error: 'invalid_email' }, 400);

  await c.env.DB.prepare(
    `INSERT INTO leads (name, email, phone, company, budget, message) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(name, email, phone || null, company || null, budget || null, message).run();

  if (c.env.RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: c.env.RESEND_FROM_EMAIL,
          to: c.env.ADMIN_NOTIFY_EMAIL,
          reply_to: email,
          subject: `New enquiry from ${name}`,
          text: [
            `Name: ${name}`,
            `Email: ${email}`,
            `Phone: ${phone || '-'}`,
            `Company/Project: ${company || '-'}`,
            `Budget: ${budget || '-'}`,
            '',
            message,
          ].join('\n'),
        }),
      });
    } catch (err) {
      // The lead is already saved in D1 — the email is a best-effort nicety,
      // so a Resend hiccup shouldn't turn into a failed submission.
      console.error('resend notify failed', err);
    }
  }

  return c.json({ ok: true });
});

app.get('/api/leads', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, email, phone, company, budget, message, created_at
     FROM leads ORDER BY id DESC`
  ).all();
  return c.json({ leads: results });
});

// html_handling = "none" means the ASSETS binding won't map "/" to
// "/index.html" on its own, so that has to be rewritten explicitly here.
app.get('/', (c) => {
  const url = new URL(c.req.url);
  url.pathname = '/index.html';
  return c.env.ASSETS.fetch(new Request(url, c.req.raw));
});

app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
