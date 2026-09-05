import { Hono } from 'hono';
import * as auth from './auth.js';
import { getDb } from './db.js';
import { sessionMiddleware, destroySession } from './session.js';

const app = new Hono();

const SESSIONED_PATHS = ['/', '/index.html', '/admin.html', '/login.html', '/api/*', '/uploads/*'];
for (const path of SESSIONED_PATHS) app.use(path, sessionMiddleware);

async function requireAdmin(c, next) {
  const session = c.get('session');
  if (!session.loggedIn) return c.json({ error: 'not_authenticated' }, 401);
  return next();
}

// ---------- Auth ----------

app.get('/api/auth/me', (c) => {
  const session = c.get('session');
  return c.json({ loggedIn: !!session.loggedIn, username: session.username || null });
});

app.get('/api/auth/bootstrap-status', async (c) => {
  return c.json({ needsBootstrap: !(await auth.hasAnyAdmin(c.env)) });
});

app.post('/api/auth/bootstrap', async (c) => {
  if (await auth.hasAnyAdmin(c.env)) return c.json({ error: 'Admin account already exists' }, 409);
  const { username, password } = await c.req.json();
  if (!username || !password || password.length < 8) {
    return c.json({ error: 'Username and a password of at least 8 characters are required' }, 400);
  }
  await auth.createAdmin(c.env, { username, password });
  return c.json({ ok: true });
});

app.post('/api/auth/login', async (c) => {
  const { username, password } = await c.req.json();
  const admin = await auth.verifyLogin(c.env, username || '', password || '');
  if (!admin) return c.json({ error: 'Invalid username or password' }, 401);
  const session = c.get('session');
  session.loggedIn = true;
  session.username = admin.username;
  return c.json({ ok: true, username: admin.username });
});

app.post('/api/auth/logout', (c) => {
  destroySession(c);
  return c.json({ ok: true });
});

// ---------- Availability (admin-only — not shown to site visitors) ----------

function monthRange(month) {
  // month: 'YYYY-MM'. Returns ['YYYY-MM-01', 'YYYY-MM-32'] — cheap upper bound
  // that works fine as a half-open TEXT range on 'YYYY-MM-DD' strings.
  return [`${month}-01`, `${month}-32`];
}

app.get('/api/admin/availability', requireAdmin, async (c) => {
  const month = c.req.query('month');
  if (!/^\d{4}-\d{2}$/.test(month || '')) return c.json({ error: 'month must be YYYY-MM' }, 400);
  const db = getDb(c.env);
  const [start, end] = monthRange(month);
  const rows = await db
    .prepare('SELECT event_date, session FROM bookings WHERE event_date >= ? AND event_date < ? ORDER BY event_date')
    .all(start, end);
  const byDate = {};
  for (const row of rows) {
    byDate[row.event_date] ??= { date: row.event_date, full_day: false, morning: false, evening: false };
    byDate[row.event_date][row.session] = true;
  }
  return c.json({ month, dates: Object.values(byDate) });
});

// ---------- Admin bookings ----------

app.get('/api/admin/bookings', requireAdmin, async (c) => {
  const db = getDb(c.env);
  const month = c.req.query('month');
  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) return c.json({ error: 'month must be YYYY-MM' }, 400);
    const [start, end] = monthRange(month);
    const rows = await db
      .prepare('SELECT * FROM bookings WHERE event_date >= ? AND event_date < ? ORDER BY event_date')
      .all(start, end);
    return c.json({ bookings: rows });
  }
  const rows = await db.prepare('SELECT * FROM bookings ORDER BY event_date DESC LIMIT 200').all();
  return c.json({ bookings: rows });
});

app.post('/api/admin/bookings', requireAdmin, async (c) => {
  const { event_date, session, customer_name, event_type, notes } = await c.req.json();
  if (!event_date || !['full_day', 'morning', 'evening'].includes(session)) {
    return c.json({ error: 'event_date and a valid session (full_day, morning, evening) are required' }, 400);
  }
  const db = getDb(c.env);
  const existing = await db.prepare('SELECT session FROM bookings WHERE event_date = ?').all(event_date);
  const taken = new Set(existing.map((r) => r.session));
  if (taken.has('full_day')) {
    return c.json({ error: `${event_date} is already booked for the full day` }, 409);
  }
  if (session === 'full_day' && taken.size > 0) {
    return c.json({ error: `${event_date} already has a half-day booking — cannot book the full day` }, 409);
  }
  if (taken.has(session)) {
    return c.json({ error: `${event_date} (${session}) is already booked` }, 409);
  }
  const res = await db
    .prepare('INSERT INTO bookings (event_date, session, customer_name, event_type, notes) VALUES (?, ?, ?, ?, ?)')
    .run(event_date, session, customer_name || null, event_type || null, notes || null);
  return c.json({ id: res.lastInsertRowid });
});

app.delete('/api/admin/bookings/:id', requireAdmin, async (c) => {
  const db = getDb(c.env);
  await db.prepare('DELETE FROM bookings WHERE id = ?').run(c.req.param('id'));
  return c.json({ ok: true });
});

// ---------- Gallery ----------

app.get('/api/gallery', async (c) => {
  const db = getDb(c.env);
  const rows = await db.prepare('SELECT id, r2_key, caption FROM gallery_photos ORDER BY uploaded_at DESC').all();
  return c.json({ photos: rows.map((r) => ({ id: r.id, caption: r.caption, url: `/uploads/${r.r2_key}` })) });
});

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024; // 3MB — event photos, client should compress before sending

app.post('/api/admin/gallery', requireAdmin, async (c) => {
  if (!c.env.UPLOADS) return c.json({ error: 'Uploads are not configured yet on this deployment' }, 503);
  const form = await c.req.formData();
  const file = form.get('file');
  const caption = form.get('caption');
  if (!file || typeof file === 'string') return c.json({ error: 'file is required' }, 400);
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({ error: `File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB) — please keep photos under 3MB.` }, 413);
  }
  const key = `${crypto.randomUUID()}-${file.name}`;
  await c.env.UPLOADS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const db = getDb(c.env);
  const res = await db
    .prepare('INSERT INTO gallery_photos (r2_key, caption) VALUES (?, ?)')
    .run(key, typeof caption === 'string' ? caption : null);
  return c.json({ id: res.lastInsertRowid, url: `/uploads/${key}` });
});

app.delete('/api/admin/gallery/:id', requireAdmin, async (c) => {
  const db = getDb(c.env);
  const row = await db.prepare('SELECT r2_key FROM gallery_photos WHERE id = ?').get(c.req.param('id'));
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (c.env.UPLOADS) await c.env.UPLOADS.delete(row.r2_key);
  await db.prepare('DELETE FROM gallery_photos WHERE id = ?').run(c.req.param('id'));
  return c.json({ ok: true });
});

app.get('/uploads/:key', async (c) => {
  if (!c.env.UPLOADS) return c.text('Uploads are not configured yet on this deployment', 503);
  const obj = await c.env.UPLOADS.get(c.req.param('key'));
  if (!obj) return c.text('Not found', 404);
  return new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream' } });
});

// ---------- Static fallback ----------
// html_handling = "none" (wrangler.toml) disables automatic "/" -> "/index.html"
// resolution, so the root path needs an explicit rewrite; every other static
// path (e.g. /login.html, /admin.html, /style.css) already matches a real file.

function fetchAsset(c, path) {
  const url = new URL(c.req.url);
  url.pathname = path;
  return c.env.ASSETS.fetch(new Request(url, c.req.raw));
}

app.get('/', (c) => fetchAsset(c, '/index.html'));
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
