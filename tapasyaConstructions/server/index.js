import { Hono } from 'hono';
import * as auth from './auth.js';
import * as oauth from './oauth.js';
import { getDb } from './db.js';
import { sessionMiddleware, destroySession } from './session.js';
import { parseCsvText, parseXlsxBuffer, fetchGoogleSheetCsv, mapRows, IMPORTABLE_ENTITY_TYPES } from './import.js';

const app = new Hono();

// ---------- Auth gates ----------
// Roles: director (full access, all projects) | site_supervisor (view+edit their
// scoped project(s)) | auditor (view-only, scoped project(s)) | viewer (view-only,
// all projects — the default for any new self-service Google/OTP login).

async function requireLogin(c, next) {
  const session = c.get('session');
  if (!session.loggedIn) return c.json({ error: 'not_authenticated' }, 401);
  // Refresh role/scope from the DB on every call so a promotion/demotion by a
  // director takes effect immediately, not just on next login.
  if (session.userId) {
    const user = await auth.getUser(c.env, session.userId);
    if (user) {
      session.role = user.role;
      session.all_projects_access = !!user.all_projects_access;
      session.name = user.name;
    }
  }
  return next();
}

async function requirePageLogin(c, next) {
  if (c.get('session').loggedIn) return next();
  return c.redirect('/login.html');
}

async function requireDirector(c, next) {
  if (c.get('session').role === 'director') return next();
  return c.json({ error: 'forbidden' }, 403);
}

async function accessibleProjectIds(c) {
  const session = c.get('session');
  if (session.role === 'director' || session.role === 'viewer') return 'all';
  if (session.all_projects_access) return 'all';
  return auth.assignedProjectIds(c.env, session.userId);
}

async function canAccessProject(c, projectId) {
  const ids = await accessibleProjectIds(c);
  if (ids === 'all') return true;
  return ids.map(String).includes(String(projectId));
}

function canWriteRole(role) {
  return role === 'director' || role === 'site_supervisor';
}

async function canWriteProject(c, projectId) {
  if (!canWriteRole(c.get('session').role)) return false;
  return canAccessProject(c, projectId);
}

app.use('/', sessionMiddleware);
app.use('/index.html', sessionMiddleware);
app.use('/project.html', sessionMiddleware);
app.use('/api/*', sessionMiddleware);
app.use('/auth/*', sessionMiddleware);

function fetchAsset(c, path) {
  const url = new URL(c.req.url);
  url.pathname = path;
  return c.env.ASSETS.fetch(new Request(url, c.req.raw));
}

app.get('/', requirePageLogin, (c) => fetchAsset(c, '/index.html'));
app.get('/index.html', requirePageLogin, (c) => fetchAsset(c, '/index.html'));
app.get('/project.html', requirePageLogin, (c) => fetchAsset(c, '/project.html'));

app.get('/auth/google', oauth.googleAuthStart);
app.get('/auth/google/callback', oauth.googleAuthCallback);

const PUBLIC_API_PATHS = new Set([
  '/api/auth/status',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/bootstrap',
  '/api/auth/guest',
  '/api/auth/pending-verification',
  '/api/auth/pending-verification/resend',
  '/api/auth/verify-first-login',
  '/api/settings/background-image',
  '/api/settings/logo-image',
]);

app.use('/api/*', async (c, next) => {
  if (PUBLIC_API_PATHS.has(new URL(c.req.url).pathname)) return next();
  return requireLogin(c, next);
});

// ---------- Auth ----------

app.get('/api/auth/status', async (c) => {
  return c.json({ hasAnyStaffUser: await auth.hasAnyStaffUser(c.env) });
});

app.get('/api/auth/me', (c) => {
  const session = c.get('session');
  return c.json({
    userId: session.userId,
    name: session.name,
    email: session.email || null,
    role: session.role,
    all_projects_access: !!session.all_projects_access,
  });
});

app.post('/api/auth/login', async (c) => {
  const { username, password } = await c.req.json();
  const user = await auth.verifyLogin(c.env, username || '', password || '');
  if (!user) return c.json({ error: 'Incorrect username or password' }, 401);
  const session = c.get('session');
  session.loggedIn = true;
  session.userId = user.id;
  session.name = user.name;
  session.role = user.role;
  session.all_projects_access = !!user.all_projects_access;
  return c.json({ ok: true, role: user.role });
});

app.get('/api/auth/logout', async (c) => {
  destroySession(c);
  return c.redirect('/login.html');
});

// First-run bootstrap: create the first director account when none exist yet.
app.post('/api/auth/bootstrap', async (c) => {
  if (await auth.hasAnyStaffUser(c.env)) {
    return c.json({ error: 'Already set up' }, 400);
  }
  const { name, username, password } = await c.req.json();
  if (!name || !username || !password || password.length < 4) {
    return c.json({ error: 'Name, username, and a password of at least 4 characters are required' }, 400);
  }
  const id = await auth.createStaffUser(c.env, { name, username, password, role: 'director', allProjectsAccess: true });
  const session = c.get('session');
  session.loggedIn = true;
  session.userId = id;
  session.name = name;
  session.role = 'director';
  session.all_projects_access = true;
  return c.json({ ok: true });
});

// Skip sign-in entirely and view read-only, no account needed. An anonymous
// viewer session — no userId, so requireLogin's role-refresh step just leaves it
// alone; there's no account to later promote since nothing identifies who this is.
app.post('/api/auth/guest', async (c) => {
  const session = c.get('session');
  session.loggedIn = true;
  session.userId = null;
  session.name = 'Guest';
  session.role = 'viewer';
  session.all_projects_access = false;
  return c.json({ ok: true });
});

// ---------- First-login email verification (Google) ----------
// oauth.js sets session.pendingEmail instead of logging in directly the first
// time it sees an email, and sends a code to it. Nothing is granted until that
// code comes back here.

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
  const user = await auth.recordEmailLogin(c.env, email, session.pendingName);
  session.pendingEmail = null;
  session.pendingName = null;
  session.loggedIn = true;
  session.userId = user.id;
  session.email = user.email;
  session.name = user.name;
  session.role = user.role;
  session.all_projects_access = !!user.all_projects_access;
  return c.json({ ok: true });
});

// ---------- User management (director only) ----------
// Covers both admin-created username/password accounts and promoting
// self-service Google/OTP accounts (default role 'viewer') to
// site_supervisor/auditor/director, with per-project or all-project scope.

app.get('/api/users', requireDirector, async (c) => {
  return c.json(await auth.listUsers(c.env));
});

app.post('/api/users', requireDirector, async (c) => {
  const { name, username, password, role, all_projects_access } = await c.req.json();
  if (!name || !username || !password || password.length < 4) {
    return c.json({ error: 'Name, username, and a password of at least 4 characters are required' }, 400);
  }
  try {
    const id = await auth.createStaffUser(c.env, { name, username, password, role, allProjectsAccess: all_projects_access });
    return c.json({ ok: true, id });
  } catch (err) {
    return c.json({ error: 'That username is already taken' }, 400);
  }
});

app.patch('/api/users/:id/role', requireDirector, async (c) => {
  const { role, all_projects_access } = await c.req.json();
  if (!['director', 'site_supervisor', 'auditor', 'viewer'].includes(role)) {
    return c.json({ error: 'invalid role' }, 400);
  }
  await auth.setUserRole(c.env, c.req.param('id'), role, all_projects_access);
  return c.json({ ok: true });
});

app.post('/api/users/:id/assignments', requireDirector, async (c) => {
  const { project_id } = await c.req.json();
  await auth.assignProject(c.env, c.req.param('id'), project_id);
  return c.json({ ok: true });
});
app.delete('/api/users/:id/assignments/:projectId', requireDirector, async (c) => {
  await auth.unassignProject(c.env, c.req.param('id'), c.req.param('projectId'));
  return c.json({ ok: true });
});
app.get('/api/users/:id/assignments', requireDirector, async (c) => {
  return c.json(await auth.assignedProjectIds(c.env, c.req.param('id')));
});

// ---------- Background image (director-configurable, stored in KV) ----------

app.get('/api/settings/background-image', async (c) => {
  const img = await auth.getBackgroundImage(c.env);
  if (!img) return c.text('Not set', 404);
  return new Response(img.bytes, { headers: { 'Content-Type': img.contentType, 'Cache-Control': 'public, max-age=300' } });
});

app.post('/api/settings/background', requireDirector, async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return c.json({ error: 'file is required' }, 400);
  await auth.setBackgroundImage(c.env, await file.arrayBuffer(), file.type || 'image/jpeg');
  return c.json({ ok: true });
});

app.get('/api/settings/logo-image', async (c) => {
  const img = await auth.getSiteLogo(c.env);
  if (!img) return c.text('Not set', 404);
  return new Response(img.bytes, { headers: { 'Content-Type': img.contentType, 'Cache-Control': 'public, max-age=300' } });
});

app.post('/api/settings/logo', requireDirector, async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return c.json({ error: 'file is required' }, 400);
  await auth.setSiteLogo(c.env, await file.arrayBuffer(), file.type || 'image/png');
  return c.json({ ok: true });
});

// ---------- Generic CRUD factory ----------

// internalOnly (default true): every resource below is cost/financial data —
// materials, payments, labor, equipment, funding, vendors — none of it is meant
// for the public-facing viewer/guest experience (see the showcase endpoints
// further down for what viewers get instead: floor plans, reviews, pricing).
function crudRoutes({ path, table, fields, projectScoped = true, decorate, internalOnly = true }) {
  const decorateRow = decorate || ((r) => r);

  app.get(`/api/${path}`, async (c) => {
    if (internalOnly && c.get('session').role === 'viewer') return c.json({ error: 'forbidden' }, 403);
    const db = getDb(c.env);
    const projectId = c.req.query('project_id');
    let sql = `SELECT * FROM ${table}`;
    const params = [];
    const clauses = [];

    if (projectScoped) {
      if (projectId) {
        if (!(await canAccessProject(c, projectId))) return c.json({ error: 'forbidden' }, 403);
        clauses.push('project_id = ?');
        params.push(projectId);
      } else {
        const ids = await accessibleProjectIds(c);
        if (ids !== 'all') {
          if (ids.length === 0) return c.json([]);
          clauses.push(`project_id IN (${ids.map(() => '?').join(',')})`);
          params.push(...ids);
        }
      }
    }
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY id DESC';

    const rows = await db.prepare(sql).all(...params);
    return c.json(rows.map(decorateRow));
  });

  app.get(`/api/${path}/:id`, async (c) => {
    if (internalOnly && c.get('session').role === 'viewer') return c.json({ error: 'forbidden' }, 403);
    const db = getDb(c.env);
    const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(c.req.param('id'));
    if (!row) return c.json({ error: 'not_found' }, 404);
    if (projectScoped && !(await canAccessProject(c, row.project_id))) return c.json({ error: 'forbidden' }, 403);
    return c.json(decorateRow(row));
  });

  app.post(`/api/${path}`, async (c) => {
    if (internalOnly && c.get('session').role === 'viewer') return c.json({ error: 'forbidden' }, 403);
    const body = await c.req.json();
    if (projectScoped && !(await canWriteProject(c, body.project_id))) return c.json({ error: 'forbidden' }, 403);
    if (!projectScoped && !canWriteRole(c.get('session').role)) return c.json({ error: 'forbidden' }, 403);
    const db = getDb(c.env);
    const cols = fields.filter((f) => f in body);
    if (cols.length === 0) return c.json({ error: 'no valid fields provided' }, 400);
    const placeholders = cols.map(() => '?').join(', ');
    const values = cols.map((f) => body[f]);
    const res = await db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`).run(...values);
    const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(res.lastInsertRowid);
    return c.json(decorateRow(row));
  });

  app.patch(`/api/${path}/:id`, async (c) => {
    const db = getDb(c.env);
    const existing = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(c.req.param('id'));
    if (!existing) return c.json({ error: 'not_found' }, 404);
    if (projectScoped && !(await canWriteProject(c, existing.project_id))) return c.json({ error: 'forbidden' }, 403);
    if (!projectScoped && !canWriteRole(c.get('session').role)) return c.json({ error: 'forbidden' }, 403);
    const body = await c.req.json();
    const cols = fields.filter((f) => f in body);
    if (cols.length === 0) return c.json(decorateRow(existing));
    const setClause = cols.map((f) => `${f} = ?`).join(', ');
    const values = cols.map((f) => body[f]);
    await db.prepare(`UPDATE ${table} SET ${setClause} WHERE id = ?`).run(...values, c.req.param('id'));
    const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(c.req.param('id'));
    return c.json(decorateRow(row));
  });

  app.delete(`/api/${path}/:id`, async (c) => {
    const db = getDb(c.env);
    const existing = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(c.req.param('id'));
    if (!existing) return c.json({ error: 'not_found' }, 404);
    if (projectScoped && !(await canWriteProject(c, existing.project_id))) return c.json({ error: 'forbidden' }, 403);
    if (!projectScoped && !canWriteRole(c.get('session').role)) return c.json({ error: 'forbidden' }, 403);
    await db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(c.req.param('id'));
    return c.json({ ok: true });
  });
}

function withBalance(row) {
  return { ...row, amount_balance: (row.amount_total || 0) - (row.amount_paid || 0) };
}

// ---------- Master data (not project-scoped; director/site_supervisor can write) ----------

crudRoutes({ path: 'material-types', table: 'material_types', fields: ['name', 'default_unit'], projectScoped: false });
crudRoutes({
  path: 'vendors',
  table: 'vendors',
  fields: ['name', 'contact_person', 'phone', 'email', 'gst_number', 'address'],
  projectScoped: false,
});

// ---------- Projects ----------

app.get('/api/projects', async (c) => {
  // Includes total_budget — internal only. Viewers/guests use /api/public/projects.
  if (c.get('session').role === 'viewer') return c.json({ error: 'forbidden' }, 403);
  const db = getDb(c.env);
  const ids = await accessibleProjectIds(c);
  let rows;
  if (ids === 'all') rows = await db.prepare('SELECT * FROM projects ORDER BY id DESC').all();
  else if (ids.length === 0) rows = [];
  else rows = await db.prepare(`SELECT * FROM projects WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id DESC`).all(...ids);
  return c.json(rows);
});

app.get('/api/projects/:id', async (c) => {
  if (c.get('session').role === 'viewer') return c.json({ error: 'forbidden' }, 403);
  if (!(await canAccessProject(c, c.req.param('id')))) return c.json({ error: 'forbidden' }, 403);
  const db = getDb(c.env);
  const row = await db.prepare('SELECT * FROM projects WHERE id = ?').get(c.req.param('id'));
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json(row);
});

const PROJECT_FIELDS = [
  'name', 'client_name', 'site_address', 'city', 'start_date', 'expected_end_date',
  'actual_end_date', 'status', 'total_budget', 'description',
  'price_per_sqft', 'total_area_sqft', 'sold_price_total', 'amenities', 'cover_media_id',
];

app.post('/api/projects', requireDirector, async (c) => {
  const body = await c.req.json();
  if (!body.name) return c.json({ error: 'name is required' }, 400);
  const db = getDb(c.env);
  const cols = PROJECT_FIELDS.filter((f) => f in body);
  const placeholders = cols.map(() => '?').join(', ');
  const res = await db.prepare(`INSERT INTO projects (${cols.join(', ')}) VALUES (${placeholders})`).run(...cols.map((f) => body[f]));
  const row = await db.prepare('SELECT * FROM projects WHERE id = ?').get(res.lastInsertRowid);
  return c.json(row);
});

app.patch('/api/projects/:id', requireDirector, async (c) => {
  const body = await c.req.json();
  const db = getDb(c.env);
  const cols = PROJECT_FIELDS.filter((f) => f in body);
  if (cols.length > 0) {
    const setClause = cols.map((f) => `${f} = ?`).join(', ');
    await db.prepare(`UPDATE projects SET ${setClause} WHERE id = ?`).run(...cols.map((f) => body[f]), c.req.param('id'));
  }
  const row = await db.prepare('SELECT * FROM projects WHERE id = ?').get(c.req.param('id'));
  return c.json(row);
});

app.delete('/api/projects/:id', requireDirector, async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  // No FK cascade in SQLite by default — delete every dependent table explicitly,
  // so this is a real clean removal rather than leaving orphaned rows behind.
  await db.prepare('DELETE FROM payments WHERE project_id = ?').run(id);
  await db.prepare('DELETE FROM material_entries WHERE project_id = ?').run(id);
  await db.prepare('DELETE FROM labor_entries WHERE project_id = ?').run(id);
  await db.prepare('DELETE FROM equipment_entries WHERE project_id = ?').run(id);
  await db.prepare('DELETE FROM project_funding WHERE project_id = ?').run(id);
  await db.prepare('DELETE FROM project_media WHERE project_id = ?').run(id);
  await db.prepare('DELETE FROM project_reviews WHERE project_id = ?').run(id);
  await db.prepare('DELETE FROM project_assignments WHERE project_id = ?').run(id);
  await db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  return c.json({ ok: true });
});

// ---------- Material entries ----------

crudRoutes({
  path: 'material-entries',
  table: 'material_entries',
  fields: [
    'project_id', 'material_type_id', 'vendor_id', 'date', 'quantity_ordered',
    'quantity_received', 'unit', 'rate_per_unit', 'amount_total', 'invoice_number',
    'bill_attachment_key', 'status', 'notes', 'created_by',
  ],
  decorate: withBalance,
});

// ---------- Labor & equipment ----------

crudRoutes({
  path: 'labor-entries',
  table: 'labor_entries',
  fields: ['project_id', 'date', 'trade', 'contractor_name', 'worker_count', 'wage_rate', 'amount_total', 'amount_paid', 'notes'],
  decorate: withBalance,
});

crudRoutes({
  path: 'equipment-entries',
  table: 'equipment_entries',
  fields: [
    'project_id', 'equipment_name', 'vendor', 'date_from', 'date_to', 'rate',
    'rate_unit', 'amount_total', 'amount_paid', 'notes',
  ],
  decorate: withBalance,
});

// ---------- Project funding ----------

crudRoutes({
  path: 'project-funding',
  table: 'project_funding',
  fields: ['project_id', 'date', 'source', 'amount', 'payment_mode', 'transaction_id', 'remarks'],
});

// ---------- Payments ----------

async function syncMaterialEntryPaid(db, materialEntryId) {
  if (!materialEntryId) return;
  const row = await db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE material_entry_id = ?').get(materialEntryId);
  await db.prepare('UPDATE material_entries SET amount_paid = ? WHERE id = ?').run(row.total, materialEntryId);
}

const PAYMENT_FIELDS = [
  'project_id', 'material_entry_id', 'category', 'date', 'amount', 'payment_mode',
  'transaction_id', 'cheque_number', 'bank_name', 'paid_to', 'paid_by', 'receipt_attachment_key', 'remarks',
];

app.get('/api/payments', async (c) => {
  if (c.get('session').role === 'viewer') return c.json({ error: 'forbidden' }, 403);
  const db = getDb(c.env);
  const projectId = c.req.query('project_id');
  const materialEntryId = c.req.query('material_entry_id');
  let sql = 'SELECT * FROM payments';
  const clauses = [];
  const params = [];

  if (projectId) {
    if (!(await canAccessProject(c, projectId))) return c.json({ error: 'forbidden' }, 403);
    clauses.push('project_id = ?');
    params.push(projectId);
  } else {
    const ids = await accessibleProjectIds(c);
    if (ids !== 'all') {
      if (ids.length === 0) return c.json([]);
      clauses.push(`project_id IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
  }
  if (materialEntryId) {
    clauses.push('material_entry_id = ?');
    params.push(materialEntryId);
  }
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
  sql += ' ORDER BY date DESC, id DESC';

  return c.json(await db.prepare(sql).all(...params));
});

app.post('/api/payments', async (c) => {
  const body = await c.req.json();
  if (!(await canWriteProject(c, body.project_id))) return c.json({ error: 'forbidden' }, 403);
  const db = getDb(c.env);
  const cols = PAYMENT_FIELDS.filter((f) => f in body);
  const placeholders = cols.map(() => '?').join(', ');
  const res = await db.prepare(`INSERT INTO payments (${cols.join(', ')}) VALUES (${placeholders})`).run(...cols.map((f) => body[f]));
  await syncMaterialEntryPaid(db, body.material_entry_id);
  const row = await db.prepare('SELECT * FROM payments WHERE id = ?').get(res.lastInsertRowid);
  return c.json(row);
});

app.patch('/api/payments/:id', async (c) => {
  const db = getDb(c.env);
  const existing = await db.prepare('SELECT * FROM payments WHERE id = ?').get(c.req.param('id'));
  if (!existing) return c.json({ error: 'not_found' }, 404);
  if (!(await canWriteProject(c, existing.project_id))) return c.json({ error: 'forbidden' }, 403);
  const body = await c.req.json();
  const cols = PAYMENT_FIELDS.filter((f) => f in body);
  if (cols.length > 0) {
    const setClause = cols.map((f) => `${f} = ?`).join(', ');
    await db.prepare(`UPDATE payments SET ${setClause} WHERE id = ?`).run(...cols.map((f) => body[f]), c.req.param('id'));
  }
  await syncMaterialEntryPaid(db, existing.material_entry_id);
  if ('material_entry_id' in body && body.material_entry_id !== existing.material_entry_id) {
    await syncMaterialEntryPaid(db, body.material_entry_id);
  }
  const row = await db.prepare('SELECT * FROM payments WHERE id = ?').get(c.req.param('id'));
  return c.json(row);
});

app.delete('/api/payments/:id', async (c) => {
  const db = getDb(c.env);
  const existing = await db.prepare('SELECT * FROM payments WHERE id = ?').get(c.req.param('id'));
  if (!existing) return c.json({ error: 'not_found' }, 404);
  if (!(await canWriteProject(c, existing.project_id))) return c.json({ error: 'forbidden' }, 403);
  await db.prepare('DELETE FROM payments WHERE id = ?').run(c.req.param('id'));
  await syncMaterialEntryPaid(db, existing.material_entry_id);
  return c.json({ ok: true });
});

// ---------- Import (Google Sheet link or uploaded Excel/CSV file) ----------
// Generic across every project and every tracked entity type — matches columns by
// header name (see server/import.js) rather than requiring an exact template, so
// it tolerates whatever sheet a project actually uses.

async function resolveMaterialTypeId(db, name) {
  const existing = await db.prepare('SELECT * FROM material_types WHERE lower(name) = lower(?)').get(name);
  if (existing) return existing;
  const res = await db.prepare('INSERT INTO material_types (name, default_unit) VALUES (?, ?)').run(name, 'units');
  return { id: res.lastInsertRowid, default_unit: 'units' };
}

async function resolveVendorId(db, name) {
  if (!name) return null;
  const existing = await db.prepare('SELECT id FROM vendors WHERE lower(name) = lower(?)').get(name);
  if (existing) return existing.id;
  const res = await db.prepare('INSERT INTO vendors (name) VALUES (?)').run(name);
  return res.lastInsertRowid;
}

app.get('/api/import/entity-types', (c) => c.json(IMPORTABLE_ENTITY_TYPES));

app.post('/api/projects/:id/import', async (c) => {
  const projectId = c.req.param('id');
  if (!(await canWriteProject(c, projectId))) return c.json({ error: 'forbidden' }, 403);
  const db = getDb(c.env);

  const form = await c.req.formData();
  const entityType = form.get('entity_type');
  const sheetUrl = form.get('sheet_url');
  const sheetTab = form.get('sheet_tab') || undefined;
  const file = form.get('file');
  if (!IMPORTABLE_ENTITY_TYPES.includes(entityType)) return c.json({ error: `entity_type must be one of: ${IMPORTABLE_ENTITY_TYPES.join(', ')}` }, 400);

  let rowsAoA;
  try {
    if (file && typeof file !== 'string') {
      const name = (file.name || '').toLowerCase();
      const buf = await file.arrayBuffer();
      rowsAoA = name.endsWith('.csv') ? parseCsvText(new TextDecoder().decode(buf)) : await parseXlsxBuffer(buf);
    } else if (sheetUrl) {
      const csv = await fetchGoogleSheetCsv(sheetUrl, sheetTab);
      rowsAoA = parseCsvText(csv);
    } else {
      return c.json({ error: 'Provide either a file upload or a sheet_url' }, 400);
    }
  } catch (e) {
    return c.json({ error: e.message }, 400);
  }

  let mapped;
  try {
    mapped = mapRows(rowsAoA, entityType);
  } catch (e) {
    return c.json({ error: e.message }, 400);
  }
  if (mapped.matchedFields.length === 0) {
    return c.json({ error: 'No recognizable columns found in this sheet for that import type', unmatchedHeaders: mapped.unmatchedHeaders }, 400);
  }

  const createdMaterialTypes = new Set();
  const createdVendors = new Set();
  let imported = 0;
  const warnings = [];

  for (const { rec, warnings: rowWarnings, row } of mapped.records) {
    if (rowWarnings.length) warnings.push({ row, messages: rowWarnings });
    const record = { project_id: projectId, ...rec };

    if (entityType === 'material_entries') {
      const type = await resolveMaterialTypeId(db, rec.material_type);
      createdMaterialTypes.add(rec.material_type);
      record.material_type_id = type.id;
      delete record.material_type;
      record.unit = rec.unit || type.default_unit;
      if (rec.vendor) {
        record.vendor_id = await resolveVendorId(db, rec.vendor);
        createdVendors.add(rec.vendor);
      }
      delete record.vendor;
    }

    const cols = Object.keys(record);
    const placeholders = cols.map(() => '?').join(', ');
    await db.prepare(`INSERT INTO ${mapped.table} (${cols.join(', ')}) VALUES (${placeholders})`).run(...cols.map((f) => record[f]));
    imported++;
  }

  return c.json({
    imported,
    skipped: mapped.skipped,
    warnings,
    matchedFields: mapped.matchedFields,
    unmatchedHeaders: mapped.unmatchedHeaders,
    createdMaterialTypes: [...createdMaterialTypes],
    createdVendors: [...createdVendors],
  });
});

// ---------- Dashboard ----------

app.get('/api/dashboard', async (c) => {
  if (c.get('session').role === 'viewer') return c.json({ error: 'forbidden' }, 403);
  const db = getDb(c.env);
  const ids = await accessibleProjectIds(c);

  const projects =
    ids === 'all'
      ? await db.prepare('SELECT * FROM projects ORDER BY id DESC').all()
      : ids.length === 0
      ? []
      : await db.prepare(`SELECT * FROM projects WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id DESC`).all(...ids);

  async function spendByProject(table) {
    const rows = await db
      .prepare(`SELECT project_id, COALESCE(SUM(amount_total),0) as total, COALESCE(SUM(amount_paid),0) as paid FROM ${table} GROUP BY project_id`)
      .all();
    const map = {};
    rows.forEach((r) => (map[r.project_id] = r));
    return map;
  }

  const [materialSpend, laborSpend, equipmentSpend] = await Promise.all([
    spendByProject('material_entries'),
    spendByProject('labor_entries'),
    spendByProject('equipment_entries'),
  ]);
  const fundingRows = await db.prepare('SELECT project_id, COALESCE(SUM(amount),0) as total FROM project_funding GROUP BY project_id').all();
  const fundingMap = {};
  fundingRows.forEach((r) => (fundingMap[r.project_id] = r.total));

  // Payments not linked to a material entry (material_entry_id IS NULL) — e.g.
  // imported bank-transaction records, or labor/equipment/misc payments logged
  // directly — have no separate "committed" line item of their own. Recording
  // the payment IS the commitment, so it counts as both committed and paid;
  // otherwise they'd be invisible to these totals even though real money moved.
  // (Payments linked to a material entry already flow into that entry's own
  // amount_paid via syncMaterialEntryPaid, so they're excluded here to avoid
  // double-counting.)
  const unlinkedPaymentRows = await db
    .prepare('SELECT project_id, COALESCE(SUM(amount),0) as total FROM payments WHERE material_entry_id IS NULL GROUP BY project_id')
    .all();
  const unlinkedPaymentMap = {};
  unlinkedPaymentRows.forEach((r) => (unlinkedPaymentMap[r.project_id] = r.total));

  const projectSummaries = projects.map((p) => {
    const m = materialSpend[p.id] || { total: 0, paid: 0 };
    const l = laborSpend[p.id] || { total: 0, paid: 0 };
    const e = equipmentSpend[p.id] || { total: 0, paid: 0 };
    const directPayments = unlinkedPaymentMap[p.id] || 0;
    const committed = m.total + l.total + e.total + directPayments;
    const paid = m.paid + l.paid + e.paid + directPayments;
    const funding = fundingMap[p.id] || 0;
    return {
      ...p,
      committed,
      paid,
      balance_due: committed - paid,
      funding_received: funding,
      budget_used_pct: p.total_budget > 0 ? Math.round((committed / p.total_budget) * 100) : 0,
    };
  });

  const totals = projectSummaries.reduce(
    (acc, p) => ({
      total_budget: acc.total_budget + (p.total_budget || 0),
      committed: acc.committed + p.committed,
      paid: acc.paid + p.paid,
      balance_due: acc.balance_due + p.balance_due,
      funding_received: acc.funding_received + p.funding_received,
    }),
    { total_budget: 0, committed: 0, paid: 0, balance_due: 0, funding_received: 0 }
  );

  const recentMaterials = await db.prepare('SELECT * FROM material_entries ORDER BY id DESC LIMIT 8').all();
  const recentPayments = await db.prepare('SELECT * FROM payments ORDER BY id DESC LIMIT 8').all();

  return c.json({ projects: projectSummaries, totals, recentMaterials, recentPayments });
});

// ---------- Public showcase (viewer/guest) ----------
// What non-staff visitors see instead of the internal financial dashboard: no
// cost/payment data at all, just project marketing content — floor plans and
// progress photos for ongoing projects, floor plans/reviews/pricing for
// completed ones. Deliberately open to every role (director/site_supervisor/
// auditor can see it too, e.g. while managing it), not gated to viewer only.

const PUBLIC_PROJECT_FIELDS = [
  'id', 'name', 'client_name', 'city', 'status', 'description', 'start_date',
  'expected_end_date', 'actual_end_date', 'price_per_sqft', 'total_area_sqft',
  'sold_price_total', 'amenities',
];

function toPublicProject(row, coverImageKey) {
  const out = {};
  PUBLIC_PROJECT_FIELDS.forEach((f) => (out[f] = row[f]));
  out.cover_image_key = coverImageKey || null;
  return out;
}

// The admin-picked cover_media_id wins; otherwise fall back to the first
// uploaded floor plan, so a project isn't coverless just because no one's
// explicitly chosen a display photo yet.
async function resolveCoverImages(db, projectIds) {
  if (projectIds.length === 0) return {};
  const placeholders = projectIds.map(() => '?').join(',');
  const explicit = await db
    .prepare(
      `SELECT p.id as project_id, m.image_key FROM projects p JOIN project_media m ON m.id = p.cover_media_id WHERE p.id IN (${placeholders})`
    )
    .all(...projectIds);
  const coverMap = {};
  explicit.forEach((r) => (coverMap[r.project_id] = r.image_key));

  const missing = projectIds.filter((id) => !(id in coverMap));
  if (missing.length > 0) {
    const fbPlaceholders = missing.map(() => '?').join(',');
    const fallback = await db
      .prepare(
        `SELECT project_id, image_key FROM project_media WHERE project_id IN (${fbPlaceholders}) AND category = 'floor_plan' ORDER BY project_id, display_order, id`
      )
      .all(...missing);
    fallback.forEach((r) => {
      if (!(r.project_id in coverMap)) coverMap[r.project_id] = r.image_key;
    });
  }
  return coverMap;
}

app.get('/api/public/projects', async (c) => {
  const db = getDb(c.env);
  const rows = await db.prepare('SELECT * FROM projects ORDER BY id DESC').all();
  const covers = await resolveCoverImages(db, rows.map((r) => r.id));
  return c.json(rows.map((r) => toPublicProject(r, covers[r.id])));
});

app.get('/api/public/projects/:id', async (c) => {
  const db = getDb(c.env);
  const row = await db.prepare('SELECT * FROM projects WHERE id = ?').get(c.req.param('id'));
  if (!row) return c.json({ error: 'not_found' }, 404);
  const covers = await resolveCoverImages(db, [row.id]);
  return c.json(toPublicProject(row, covers[row.id]));
});

app.get('/api/projects/:id/media', async (c) => {
  const db = getDb(c.env);
  const category = c.req.query('category');
  let sql = 'SELECT * FROM project_media WHERE project_id = ?';
  const params = [c.req.param('id')];
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  sql += ' ORDER BY display_order, id';
  return c.json(await db.prepare(sql).all(...params));
});

app.post('/api/projects/:id/media', async (c) => {
  if (!(await canWriteProject(c, c.req.param('id')))) return c.json({ error: 'forbidden' }, 403);
  const { category, image_key, title, caption, display_order } = await c.req.json();
  if (!image_key) return c.json({ error: 'image_key is required (upload via /api/uploads first)' }, 400);
  const db = getDb(c.env);
  const res = await db
    .prepare('INSERT INTO project_media (project_id, category, image_key, title, caption, display_order) VALUES (?, ?, ?, ?, ?, ?)')
    .run(c.req.param('id'), category || 'gallery', image_key, title || null, caption || null, display_order || 0);
  return c.json(await db.prepare('SELECT * FROM project_media WHERE id = ?').get(res.lastInsertRowid));
});

app.delete('/api/projects/:id/media/:mediaId', async (c) => {
  if (!(await canWriteProject(c, c.req.param('id')))) return c.json({ error: 'forbidden' }, 403);
  const db = getDb(c.env);
  await db.prepare('DELETE FROM project_media WHERE id = ? AND project_id = ?').run(c.req.param('mediaId'), c.req.param('id'));
  return c.json({ ok: true });
});

app.get('/api/projects/:id/reviews', async (c) => {
  const db = getDb(c.env);
  return c.json(
    await db.prepare('SELECT * FROM project_reviews WHERE project_id = ? ORDER BY date DESC, id DESC').all(c.req.param('id'))
  );
});

app.post('/api/projects/:id/reviews', async (c) => {
  if (!(await canWriteProject(c, c.req.param('id')))) return c.json({ error: 'forbidden' }, 403);
  const { customer_name, rating, review_text, date } = await c.req.json();
  if (!customer_name) return c.json({ error: 'customer_name is required' }, 400);
  const db = getDb(c.env);
  const res = await db
    .prepare('INSERT INTO project_reviews (project_id, customer_name, rating, review_text, date) VALUES (?, ?, ?, ?, ?)')
    .run(c.req.param('id'), customer_name, rating || 5, review_text || null, date || null);
  return c.json(await db.prepare('SELECT * FROM project_reviews WHERE id = ?').get(res.lastInsertRowid));
});

app.delete('/api/projects/:id/reviews/:reviewId', async (c) => {
  if (!(await canWriteProject(c, c.req.param('id')))) return c.json({ error: 'forbidden' }, 403);
  const db = getDb(c.env);
  await db.prepare('DELETE FROM project_reviews WHERE id = ? AND project_id = ?').run(c.req.param('reviewId'), c.req.param('id'));
  return c.json({ ok: true });
});

// Picking which photo represents a project is content management, same
// privilege level as uploading media — not a core business-field edit like
// budget/status, so it doesn't need requireDirector like the rest of the
// project record does.
app.post('/api/projects/:id/cover', async (c) => {
  if (!(await canWriteProject(c, c.req.param('id')))) return c.json({ error: 'forbidden' }, 403);
  const { media_id } = await c.req.json();
  const db = getDb(c.env);
  const media = await db.prepare('SELECT id FROM project_media WHERE id = ? AND project_id = ?').get(media_id, c.req.param('id'));
  if (!media) return c.json({ error: 'not_found' }, 404);
  await db.prepare('UPDATE projects SET cover_media_id = ? WHERE id = ?').run(media_id, c.req.param('id'));
  return c.json({ ok: true });
});

// ---------- Uploads (R2) ----------
// Degrades gracefully until the UPLOADS binding is added to wrangler.toml.

app.post('/api/uploads', async (c) => {
  if (!c.env.UPLOADS) return c.json({ error: 'Uploads are not configured yet on this deployment' }, 503);
  const form = await c.req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return c.json({ error: 'file is required' }, 400);
  const key = `${crypto.randomUUID()}-${file.name}`;
  await c.env.UPLOADS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return c.json({ key });
});

app.get('/uploads/:key', async (c) => {
  if (!c.env.UPLOADS) return c.text('Uploads are not configured yet on this deployment', 503);
  const obj = await c.env.UPLOADS.get(c.req.param('key'));
  if (!obj) return c.text('Not found', 404);
  return new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream' } });
});

// Everything else (style.css, app.js, login.html, ...) is a public static file.
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
