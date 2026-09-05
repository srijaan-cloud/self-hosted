import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';

const app = new Hono();

// The leads inbox is for one person (the company owner), so a single shared
// Basic Auth password is enough here — no need for the full Google-OAuth/role
// system the client-facing apps use for their multi-user staff dashboards.
function requireAdmin(c, next) {
  return basicAuth({ username: 'admin', password: c.env.ADMIN_PASSWORD })(c, next);
}

app.use('/admin.html', requireAdmin);
app.use('/api/leads', requireAdmin);

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

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
