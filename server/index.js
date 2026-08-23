import { Hono } from 'hono';
import * as auth from './auth.js';
import * as oauth from './oauth.js';
import { getDb } from './db.js';
import { FIXED_TASKS, EXTRA_TASKS, computePoints } from './points.js';
import { sessionMiddleware, destroySession } from './session.js';

const app = new Hono();

// ---------- Site-wide login wall ----------
// Everything below requires a session (session.loggedIn), established via the family
// password, Touch ID, or a Google/email-code sign-in (see oauth.js). This is
// the gate that makes it safe to expose the app publicly. requireAdmin (below) is the
// only additional gate on top of it: saving anything requires an admin session — no
// separate re-verification step.
async function requireLogin(c, next) {
  if (c.get('session').loggedIn) return next();
  return c.json({ error: 'not_authenticated' }, 401);
}

async function requirePageLogin(c, next) {
  if (c.get('session').loggedIn) return next();
  return c.redirect('/login.html');
}

// requireAdmin: everyone who signs in can view the tracker; only admins may change
// anything. Family password / Touch ID logins have no identity of their own, so
// they're always treated as admin. Email-identified sessions are re-checked against
// the users table on every call (rather than trusting the role cached at login), so
// a promotion/demotion by another admin takes effect immediately, not just on
// next login. Applied to every mutating route.
async function requireAdmin(c, next) {
  const session = c.get('session');
  if (session.userEmail) {
    session.role = await auth.getUserRole(c.env, session.userEmail);
  }
  if (session.role === 'admin') return next();
  return c.json({ error: 'read_only' }, 403);
}

// requireSaveVerified: gates saving entries. Verified either via an existing Touch
// ID device (see /api/auth/webauthn/save-*) or, while Touch ID registration is
// broken on some Android/Chrome devices, a fallback admin code (see
// /api/auth/admin-code-verify) — both set the same session flag. Single-use,
// consumed on every save — no grace period.
async function requireSaveVerified(c, next) {
  const session = c.get('session');
  if (session.saveVerified) {
    session.saveVerified = false;
    return next();
  }
  return c.json({ error: 'save_verification_required' }, 403);
}

// Session state only needs to be loaded/persisted for the document shell and API/auth
// routes — plain static assets (style.css, app.js, login.html, ...) skip it entirely.
app.use('/', sessionMiddleware);
app.use('/index.html', sessionMiddleware);
app.use('/api/*', sessionMiddleware);
app.use('/auth/*', sessionMiddleware);

function fetchIndexHtml(c) {
  // With html_handling="none", ASSETS won't implicitly map "/" to "/index.html" —
  // rewrite explicitly so both routes serve the same file.
  const url = new URL(c.req.url);
  url.pathname = '/index.html';
  return c.env.ASSETS.fetch(new Request(url, c.req.raw));
}

app.get('/', requirePageLogin, fetchIndexHtml);
app.get('/index.html', requirePageLogin, fetchIndexHtml);

app.get('/auth/google', oauth.googleAuthStart);
app.get('/auth/google/callback', oauth.googleAuthCallback);

const PUBLIC_API_PATHS = new Set([
  '/api/auth/status',
  '/api/auth/setup',
  '/api/auth/login-password',
  '/api/auth/webauthn/login-options',
  '/api/auth/webauthn/login-verify',
  '/api/auth/logout',
  '/api/auth/otp/request',
  '/api/auth/otp/verify',
  '/api/auth/password-reset/request',
  '/api/auth/password-reset/verify',
  '/api/auth/pending-verification',
  '/api/auth/pending-verification/resend',
  '/api/auth/verify-first-login',
]);

app.use('/api/*', async (c, next) => {
  if (PUBLIC_API_PATHS.has(new URL(c.req.url).pathname)) return next();
  return requireLogin(c, next);
});

// ---------- Auth status & setup ----------

app.get('/api/auth/status', async (c) => {
  return c.json({
    passwordSet: await auth.isPasswordSet(c.env),
    hasCredentials: await auth.hasCredentials(c.env),
  });
});

// Who am I: used by the app UI to decide whether to show editing controls.
// Password/Touch ID logins carry no identity, so those sessions are always admin.
// Email-identified sessions re-check the users table so a role change by another
// admin shows up without needing to log out and back in.
app.get('/api/auth/me', async (c) => {
  const session = c.get('session');
  if (session.userEmail) {
    session.role = await auth.getUserRole(c.env, session.userEmail);
  }
  return c.json({ email: session.userEmail || null, role: session.role || 'viewer' });
});

app.post('/api/auth/setup', async (c) => {
  const { password } = await c.req.json();
  if (await auth.isPasswordSet(c.env)) {
    return c.json({ error: 'Password already set' }, 400);
  }
  if (!password || password.length < 4) {
    return c.json({ error: 'Password must be at least 4 characters' }, 400);
  }
  await auth.setPassword(c.env, password);
  const session = c.get('session');
  session.loggedIn = true;
  session.role = 'admin';
  return c.json({ ok: true });
});

app.post('/api/auth/change-password', requireAdmin, async (c) => {
  const { currentPassword, newPassword } = await c.req.json();
  if (!(await auth.checkPassword(c.env, currentPassword || ''))) {
    return c.json({ error: 'Current password is incorrect' }, 401);
  }
  if (!newPassword || newPassword.length < 4) {
    return c.json({ error: 'New password must be at least 4 characters' }, 400);
  }
  await auth.setPassword(c.env, newPassword);
  return c.json({ ok: true });
});

app.post('/api/auth/login-password', async (c) => {
  const { password } = await c.req.json();
  if (!(await auth.checkPassword(c.env, password || ''))) {
    return c.json({ error: 'Incorrect password' }, 401);
  }
  const session = c.get('session');
  session.loggedIn = true;
  session.role = 'admin';
  return c.json({ ok: true });
});

app.get('/api/auth/webauthn/login-options', async (c) => {
  if (!(await auth.hasCredentials(c.env))) {
    return c.json({ error: 'No Touch ID registered yet' }, 400);
  }
  const rpId = auth.getRpId(c.env, c);
  const options = await auth.getAuthenticationOptions(c.env, rpId);
  c.get('session').loginChallenge = options.challenge;
  return c.json(options);
});

app.post('/api/auth/webauthn/login-verify', async (c) => {
  const { response } = await c.req.json();
  const expectedChallenge = c.get('session').loginChallenge;
  const rpId = auth.getRpId(c.env, c);
  try {
    const verification = await auth.verifyAuthentication(
      c.env,
      response,
      expectedChallenge,
      auth.getOrigin(c),
      rpId
    );
    if (!verification.verified) return c.json({ error: 'Could not verify' }, 400);
    const session = c.get('session');
    session.loggedIn = true;
    session.role = 'admin';
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err.message }, 400);
  }
});

// ---------- Email OTP login (any email; role decided by auth.getUserRole) ----------

app.post('/api/auth/otp/request', async (c) => {
  const { email } = await c.req.json();
  if (!auth.isValidEmail(email || '')) {
    return c.json({ error: 'Enter a valid email address' }, 400);
  }
  try {
    await auth.requestOtp(c.env, email.trim().toLowerCase());
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/auth/otp/verify', async (c) => {
  const { email, code } = await c.req.json();
  if (!auth.isValidEmail(email || '') || !code) {
    return c.json({ error: 'email and code required' }, 400);
  }
  const normalizedEmail = email.trim().toLowerCase();
  const ok = await auth.verifyOtp(c.env, normalizedEmail, String(code).trim());
  if (!ok) return c.json({ error: 'Invalid or expired code' }, 400);
  const session = c.get('session');
  session.loggedIn = true;
  session.userEmail = normalizedEmail;
  session.role = await auth.recordLogin(c.env, normalizedEmail);
  return c.json({ ok: true });
});

// ---------- First-login email verification (Google) ----------
// oauth.js sets session.pendingEmail instead of logging in directly the first time
// it sees an email, and sends a code to it. Nothing is granted until that code comes
// back here — closes the gap where a provider's claimed email was trusted blindly.

app.get('/api/auth/pending-verification', (c) => {
  return c.json({ email: c.get('session').pendingEmail || null });
});

app.post('/api/auth/pending-verification/resend', async (c) => {
  const email = c.get('session').pendingEmail;
  if (!email) return c.json({ error: 'Nothing to verify — start sign-in again' }, 400);
  try {
    await auth.requestOtp(c.env, email);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/auth/verify-first-login', async (c) => {
  const { code } = await c.req.json();
  const session = c.get('session');
  const email = session.pendingEmail;
  if (!email) return c.json({ error: 'Nothing to verify — start sign-in again' }, 400);
  const ok = await auth.verifyOtp(c.env, email, String(code || '').trim());
  if (!ok) return c.json({ error: 'Invalid or expired code' }, 400);
  session.pendingEmail = null;
  session.loggedIn = true;
  session.userEmail = email;
  session.role = await auth.recordLogin(c.env, email);
  return c.json({ ok: true });
});

// ---------- Forgot-password reset (admin emails only, via OTP) ----------
// Deliberately restricted to current admins: anyone who could reset the shared
// family password would gain admin (write) access, defeating the read-only model
// above. Any current admin qualifies, not just ADMIN_EMAIL — they already have full
// write access, so being able to also reset this shared credential grants nothing new.

app.post('/api/auth/password-reset/request', async (c) => {
  const { email } = await c.req.json();
  if (!auth.isValidEmail(email || '')) {
    return c.json({ error: 'Enter a valid email address' }, 400);
  }
  const normalizedEmail = email.trim().toLowerCase();
  if ((await auth.getUserRole(c.env, normalizedEmail)) !== 'admin') {
    return c.json({ error: 'Only an admin email can reset the password' }, 403);
  }
  try {
    await auth.requestOtp(c.env, normalizedEmail);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/auth/password-reset/verify', async (c) => {
  const { email, code, newPassword } = await c.req.json();
  if (!auth.isValidEmail(email || '') || !code) {
    return c.json({ error: 'email and code required' }, 400);
  }
  const normalizedEmail = email.trim().toLowerCase();
  if ((await auth.getUserRole(c.env, normalizedEmail)) !== 'admin') {
    return c.json({ error: 'Only an admin email can reset the password' }, 403);
  }
  if (!newPassword || newPassword.length < 4) {
    return c.json({ error: 'New password must be at least 4 characters' }, 400);
  }
  const ok = await auth.verifyOtp(c.env, normalizedEmail, String(code).trim());
  if (!ok) return c.json({ error: 'Invalid or expired code' }, 400);
  await auth.setPassword(c.env, newPassword);
  const session = c.get('session');
  session.loggedIn = true;
  session.role = 'admin';
  session.userEmail = normalizedEmail;
  return c.json({ ok: true });
});

app.get('/api/auth/logout', async (c) => {
  destroySession(c);
  return c.redirect('/login.html');
});

// ---------- Verify-to-save ----------
// Touch ID (existing devices only, never registers a new one here) is the primary
// path. admin-code-verify is a fallback for devices where Touch ID registration
// itself doesn't work (some Android/Chrome + Google Password Manager combinations) —
// see auth.checkAdminCode for why this is hardcoded rather than a stored secret.

app.post('/api/auth/admin-code-verify', requireAdmin, async (c) => {
  const { code } = await c.req.json();
  if (!auth.checkAdminCode(code || '')) {
    return c.json({ error: 'Incorrect admin code' }, 401);
  }
  c.get('session').saveVerified = true;
  return c.json({ ok: true });
});

app.get('/api/auth/webauthn/save-options', requireAdmin, async (c) => {
  if (!(await auth.hasCredentials(c.env))) {
    return c.json({ error: 'No Touch ID registered yet' }, 400);
  }
  const rpId = auth.getRpId(c.env, c);
  const options = await auth.getAuthenticationOptions(c.env, rpId);
  c.get('session').saveChallenge = options.challenge;
  return c.json(options);
});

app.post('/api/auth/webauthn/save-verify', requireAdmin, async (c) => {
  const { response } = await c.req.json();
  const expectedChallenge = c.get('session').saveChallenge;
  const rpId = auth.getRpId(c.env, c);
  try {
    const verification = await auth.verifyAuthentication(
      c.env,
      response,
      expectedChallenge,
      auth.getOrigin(c),
      rpId
    );
    if (!verification.verified) return c.json({ error: 'Could not verify' }, 400);
    c.get('session').saveVerified = true;
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err.message }, 400);
  }
});

// ---------- Touch ID device management ----------

app.get('/api/auth/credentials', async (c) => {
  return c.json(await auth.listCredentials(c.env));
});

app.get('/api/auth/webauthn/register-options', requireAdmin, async (c) => {
  const rpId = auth.getRpId(c.env, c);
  const options = await auth.getRegistrationOptions(c.env, rpId);
  c.get('session').currentChallenge = options.challenge;
  return c.json(options);
});

app.post('/api/auth/webauthn/register-verify', requireAdmin, async (c) => {
  const { response, deviceName } = await c.req.json();
  const expectedChallenge = c.get('session').currentChallenge;
  const rpId = auth.getRpId(c.env, c);
  try {
    const verification = await auth.verifyRegistration(
      c.env,
      response,
      expectedChallenge,
      auth.getOrigin(c),
      rpId,
      deviceName
    );
    if (!verification.verified) return c.json({ error: 'Could not verify registration' }, 400);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err.message }, 400);
  }
});

app.delete('/api/auth/credentials/:id', requireAdmin, async (c) => {
  await auth.deleteCredential(c.env, c.req.param('id'));
  return c.json({ ok: true });
});

// ---------- Admin: users who've signed in, and their roles ----------
// Only tracks email-identified logins (Google/OTP) — password/Touch ID
// logins have no identity to track and are always admin regardless of this table.

app.get('/api/admin/users', requireAdmin, async (c) => {
  const { users, seedAdminEmail } = await auth.listUsers(c.env);
  return c.json({ users, seedAdminEmail });
});

app.post('/api/admin/users/:email/role', requireAdmin, async (c) => {
  const email = decodeURIComponent(c.req.param('email'));
  const { role } = await c.req.json();
  if (role !== 'admin' && role !== 'viewer') {
    return c.json({ error: 'role must be admin or viewer' }, 400);
  }
  try {
    await auth.setUserRole(c.env, email, role);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err.message }, 400);
  }
});

// ---------- Children & tasks ----------

app.get('/api/children', async (c) => {
  const db = getDb(c.env);
  return c.json(await db.prepare('SELECT * FROM children ORDER BY id').all());
});

app.get('/api/tasks', (c) => {
  return c.json({ fixed: FIXED_TASKS, extra: EXTRA_TASKS });
});

// ---------- Entries ----------

function monthRange(year, month) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end, lastDay };
}

app.get('/api/entries', async (c) => {
  const childId = Number(c.req.query('child_id'));
  const year = Number(c.req.query('year'));
  const month = Number(c.req.query('month'));
  if (!childId || !year || !month) {
    return c.json({ error: 'child_id, year, month required' }, 400);
  }
  const { start, end } = monthRange(year, month);
  const db = getDb(c.env);
  const rows = await db
    .prepare('SELECT * FROM entries WHERE child_id = ? AND date >= ? AND date <= ? ORDER BY date')
    .all(childId, start, end);

  const entriesByDate = {};
  let monthTotal = 0;
  for (const row of rows) {
    const points = computePoints(row);
    entriesByDate[row.date] = { ...row, points };
    monthTotal += points.total;
  }
  return c.json({ entries: entriesByDate, monthTotal });
});

app.post('/api/entries', requireAdmin, requireSaveVerified, async (c) => {
  const { child_id, date, tasks } = await c.req.json();
  if (!child_id || !date || !tasks) {
    return c.json({ error: 'child_id, date, tasks required' }, 400);
  }
  const allKeys = [...FIXED_TASKS, ...EXTRA_TASKS].map((t) => t.key);
  const columns = allKeys.filter((k) => k in tasks);
  if (columns.length === 0) {
    return c.json({ error: 'no valid task keys provided' }, 400);
  }

  const db = getDb(c.env);
  const existing = await db
    .prepare('SELECT * FROM entries WHERE child_id = ? AND date = ?')
    .get(child_id, date);
  if (existing) {
    const setClause = columns.map((col) => `${col} = ?`).join(', ');
    const values = columns.map((col) => (tasks[col] ? 1 : 0));
    await db
      .prepare(`UPDATE entries SET ${setClause} WHERE child_id = ? AND date = ?`)
      .run(...values, child_id, date);
  } else {
    const insertCols = ['child_id', 'date', ...columns];
    const placeholders = insertCols.map(() => '?').join(', ');
    const values = [child_id, date, ...columns.map((col) => (tasks[col] ? 1 : 0))];
    await db.prepare(`INSERT INTO entries (${insertCols.join(', ')}) VALUES (${placeholders})`).run(...values);
  }

  const row = await db.prepare('SELECT * FROM entries WHERE child_id = ? AND date = ?').get(child_id, date);
  return c.json({ entry: row, points: computePoints(row) });
});

app.get('/api/summary', async (c) => {
  const childId = Number(c.req.query('child_id'));
  const year = Number(c.req.query('year'));
  const month = Number(c.req.query('month'));
  const { start, end } = monthRange(year, month);
  const db = getDb(c.env);
  const rows = await db
    .prepare('SELECT * FROM entries WHERE child_id = ? AND date >= ? AND date <= ?')
    .all(childId, start, end);
  let total = 0;
  let perfectDays = 0;
  for (const row of rows) {
    const points = computePoints(row);
    total += points.total;
    if (points.bonus > 0) perfectDays++;
  }
  return c.json({ total, daysLogged: rows.length, perfectDays });
});

// Everything else (style.css, app.js, login.html, login.js, privacy.html, the WebAuthn
// browser bundle) is a public static file with no session overhead — served directly.
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
