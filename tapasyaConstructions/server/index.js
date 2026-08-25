import { Hono } from 'hono';
import * as auth from './auth.js';
import { getDb } from './db.js';
import { sessionMiddleware, destroySession } from './session.js';

const app = new Hono();

// ---------- Auth gates ----------

async function requireLogin(c, next) {
  if (c.get('session').loggedIn) return next();
  return c.json({ error: 'not_authenticated' }, 401);
}

async function requirePageLogin(c, next) {
  if (c.get('session').loggedIn) return next();
  return c.redirect('/login.html');
}

// director/accountant see everything; site_engineer only sees assigned projects.
async function requireDirector(c, next) {
  if (c.get('session').role === 'director') return next();
  return c.json({ error: 'forbidden' }, 403);
}

async function accessibleProjectIds(c) {
  const session = c.get('session');
  if (session.role === 'director' || session.role === 'accountant') return 'all';
  return auth.assignedProjectIds(c.env, session.userId);
}

async function canAccessProject(c, projectId) {
  const ids = await accessibleProjectIds(c);
  if (ids === 'all') return true;
  return ids.map(String).includes(String(projectId));
}

app.use('/', sessionMiddleware);
app.use('/index.html', sessionMiddleware);
app.use('/project.html', sessionMiddleware);
app.use('/api/*', sessionMiddleware);

function fetchAsset(c, path) {
  const url = new URL(c.req.url);
  url.pathname = path;
  return c.env.ASSETS.fetch(new Request(url, c.req.raw));
}

app.get('/', requirePageLogin, (c) => fetchAsset(c, '/index.html'));
app.get('/index.html', requirePageLogin, (c) => fetchAsset(c, '/index.html'));
app.get('/project.html', requirePageLogin, (c) => fetchAsset(c, '/project.html'));

const PUBLIC_API_PATHS = new Set([
  '/api/auth/status',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/bootstrap',
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
  return c.json({ userId: session.userId, name: session.name, role: session.role });
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
  return c.json({ ok: true, role: user.role });
});

app.get('/api/auth/logout', async (c) => {
  destroySession(c);
  return c.redirect('/login.html');
});

// First-run bootstrap: create the first director account when none exist yet.
// Locks itself once any staff user exists — after that, only a director can add more.
app.post('/api/auth/bootstrap', async (c) => {
  if (await auth.hasAnyStaffUser(c.env)) {
    return c.json({ error: 'Already set up' }, 400);
  }
  const { name, username, password } = await c.req.json();
  if (!name || !username || !password || password.length < 4) {
    return c.json({ error: 'Name, username, and a password of at least 4 characters are required' }, 400);
  }
  const id = await auth.createStaffUser(c.env, { name, username, password, role: 'director' });
  const session = c.get('session');
  session.loggedIn = true;
  session.userId = id;
  session.name = name;
  session.role = 'director';
  return c.json({ ok: true });
});

// ---------- Staff management (director only) ----------

app.get('/api/staff', requireDirector, async (c) => {
  return c.json(await auth.listStaffUsers(c.env));
});

app.post('/api/staff', requireDirector, async (c) => {
  const { name, username, password, role } = await c.req.json();
  if (!name || !username || !password || password.length < 4) {
    return c.json({ error: 'Name, username, and a password of at least 4 characters are required' }, 400);
  }
  try {
    const id = await auth.createStaffUser(c.env, { name, username, password, role });
    return c.json({ ok: true, id });
  } catch (err) {
    return c.json({ error: 'That username is already taken' }, 400);
  }
});

app.post('/api/staff/:id/assignments', requireDirector, async (c) => {
  const { project_id } = await c.req.json();
  await auth.assignProject(c.env, c.req.param('id'), project_id);
  return c.json({ ok: true });
});

app.delete('/api/staff/:id/assignments/:projectId', requireDirector, async (c) => {
  await auth.unassignProject(c.env, c.req.param('id'), c.req.param('projectId'));
  return c.json({ ok: true });
});

app.get('/api/staff/:id/assignments', requireDirector, async (c) => {
  return c.json(await auth.assignedProjectIds(c.env, c.req.param('id')));
});

// ---------- Generic CRUD factory ----------
// Every resource below (material entries, labor, equipment, funding, vendors...)
// shares the same shape: an id PK, optionally scoped to a project, list/create/
// update/delete. This factory keeps that boilerplate in one place instead of
// repeating it seven times.

function crudRoutes({ path, table, fields, projectScoped = true, decorate }) {
  const decorateRow = decorate || ((r) => r);

  app.get(`/api/${path}`, async (c) => {
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
    const db = getDb(c.env);
    const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(c.req.param('id'));
    if (!row) return c.json({ error: 'not_found' }, 404);
    if (projectScoped && !(await canAccessProject(c, row.project_id))) {
      return c.json({ error: 'forbidden' }, 403);
    }
    return c.json(decorateRow(row));
  });

  app.post(`/api/${path}`, async (c) => {
    const body = await c.req.json();
    if (projectScoped && !(await canAccessProject(c, body.project_id))) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const db = getDb(c.env);
    const cols = fields.filter((f) => f in body);
    if (cols.length === 0) return c.json({ error: 'no valid fields provided' }, 400);
    const placeholders = cols.map(() => '?').join(', ');
    const values = cols.map((f) => body[f]);
    const res = await db
      .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`)
      .run(...values);
    const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(res.lastInsertRowid);
    return c.json(decorateRow(row));
  });

  app.patch(`/api/${path}/:id`, async (c) => {
    const db = getDb(c.env);
    const existing = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(c.req.param('id'));
    if (!existing) return c.json({ error: 'not_found' }, 404);
    if (projectScoped && !(await canAccessProject(c, existing.project_id))) {
      return c.json({ error: 'forbidden' }, 403);
    }
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
    if (projectScoped && !(await canAccessProject(c, existing.project_id))) {
      return c.json({ error: 'forbidden' }, 403);
    }
    await db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(c.req.param('id'));
    return c.json({ ok: true });
  });
}

function withBalance(row) {
  return { ...row, amount_balance: (row.amount_total || 0) - (row.amount_paid || 0) };
}

// ---------- Master data (not project-scoped) ----------

crudRoutes({
  path: 'material-types',
  table: 'material_types',
  fields: ['name', 'default_unit'],
  projectScoped: false,
});

crudRoutes({
  path: 'vendors',
  table: 'vendors',
  fields: ['name', 'contact_person', 'phone', 'email', 'gst_number', 'address'],
  projectScoped: false,
});

// ---------- Projects ----------

app.get('/api/projects', async (c) => {
  const db = getDb(c.env);
  const ids = await accessibleProjectIds(c);
  let rows;
  if (ids === 'all') {
    rows = await db.prepare('SELECT * FROM projects ORDER BY id DESC').all();
  } else if (ids.length === 0) {
    rows = [];
  } else {
    rows = await db
      .prepare(`SELECT * FROM projects WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id DESC`)
      .all(...ids);
  }
  return c.json(rows);
});

app.get('/api/projects/:id', async (c) => {
  if (!(await canAccessProject(c, c.req.param('id')))) return c.json({ error: 'forbidden' }, 403);
  const db = getDb(c.env);
  const row = await db.prepare('SELECT * FROM projects WHERE id = ?').get(c.req.param('id'));
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json(row);
});

const PROJECT_FIELDS = [
  'name', 'client_name', 'site_address', 'city', 'start_date', 'expected_end_date',
  'actual_end_date', 'status', 'total_budget', 'description',
];

app.post('/api/projects', requireDirector, async (c) => {
  const body = await c.req.json();
  if (!body.name) return c.json({ error: 'name is required' }, 400);
  const db = getDb(c.env);
  const cols = PROJECT_FIELDS.filter((f) => f in body);
  const placeholders = cols.map(() => '?').join(', ');
  const res = await db
    .prepare(`INSERT INTO projects (${cols.join(', ')}) VALUES (${placeholders})`)
    .run(...cols.map((f) => body[f]));
  const row = await db.prepare('SELECT * FROM projects WHERE id = ?').get(res.lastInsertRowid);
  return c.json(row);
});

app.patch('/api/projects/:id', requireDirector, async (c) => {
  const body = await c.req.json();
  const db = getDb(c.env);
  const cols = PROJECT_FIELDS.filter((f) => f in body);
  if (cols.length > 0) {
    const setClause = cols.map((f) => `${f} = ?`).join(', ');
    await db
      .prepare(`UPDATE projects SET ${setClause} WHERE id = ?`)
      .run(...cols.map((f) => body[f]), c.req.param('id'));
  }
  const row = await db.prepare('SELECT * FROM projects WHERE id = ?').get(c.req.param('id'));
  return c.json(row);
});

app.delete('/api/projects/:id', requireDirector, async (c) => {
  const db = getDb(c.env);
  await db.prepare('DELETE FROM projects WHERE id = ?').run(c.req.param('id'));
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
  fields: [
    'project_id', 'date', 'trade', 'contractor_name', 'worker_count', 'wage_rate',
    'amount_total', 'amount_paid', 'notes',
  ],
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

// ---------- Project funding (money coming in) ----------

crudRoutes({
  path: 'project-funding',
  table: 'project_funding',
  fields: ['project_id', 'date', 'source', 'amount', 'payment_mode', 'transaction_id', 'remarks'],
});

// ---------- Payments ----------
// A payment optionally links to a material_entry (material_entry_id). When it does,
// that material entry's amount_paid is kept in sync by summing its linked payments —
// so the "amount paid" you see on a material row is always derived from the actual
// itemized transactions (with their modes/transaction IDs), never hand-entered
// separately and liable to drift.

async function syncMaterialEntryPaid(db, materialEntryId) {
  if (!materialEntryId) return;
  const row = await db
    .prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE material_entry_id = ?')
    .get(materialEntryId);
  await db.prepare('UPDATE material_entries SET amount_paid = ? WHERE id = ?').run(row.total, materialEntryId);
}

const PAYMENT_FIELDS = [
  'project_id', 'material_entry_id', 'category', 'date', 'amount', 'payment_mode',
  'transaction_id', 'cheque_number', 'bank_name', 'paid_to', 'paid_by',
  'receipt_attachment_key', 'remarks',
];

app.get('/api/payments', async (c) => {
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
  if (!(await canAccessProject(c, body.project_id))) return c.json({ error: 'forbidden' }, 403);
  const db = getDb(c.env);
  const cols = PAYMENT_FIELDS.filter((f) => f in body);
  const placeholders = cols.map(() => '?').join(', ');
  const res = await db
    .prepare(`INSERT INTO payments (${cols.join(', ')}) VALUES (${placeholders})`)
    .run(...cols.map((f) => body[f]));
  await syncMaterialEntryPaid(db, body.material_entry_id);
  const row = await db.prepare('SELECT * FROM payments WHERE id = ?').get(res.lastInsertRowid);
  return c.json(row);
});

app.patch('/api/payments/:id', async (c) => {
  const db = getDb(c.env);
  const existing = await db.prepare('SELECT * FROM payments WHERE id = ?').get(c.req.param('id'));
  if (!existing) return c.json({ error: 'not_found' }, 404);
  if (!(await canAccessProject(c, existing.project_id))) return c.json({ error: 'forbidden' }, 403);
  const body = await c.req.json();
  const cols = PAYMENT_FIELDS.filter((f) => f in body);
  if (cols.length > 0) {
    const setClause = cols.map((f) => `${f} = ?`).join(', ');
    await db
      .prepare(`UPDATE payments SET ${setClause} WHERE id = ?`)
      .run(...cols.map((f) => body[f]), c.req.param('id'));
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
  if (!(await canAccessProject(c, existing.project_id))) return c.json({ error: 'forbidden' }, 403);
  await db.prepare('DELETE FROM payments WHERE id = ?').run(c.req.param('id'));
  await syncMaterialEntryPaid(db, existing.material_entry_id);
  return c.json({ ok: true });
});

// ---------- Dashboard ----------

app.get('/api/dashboard', async (c) => {
  const db = getDb(c.env);
  const ids = await accessibleProjectIds(c);

  const projects =
    ids === 'all'
      ? await db.prepare('SELECT * FROM projects ORDER BY id DESC').all()
      : ids.length === 0
      ? []
      : await db
          .prepare(`SELECT * FROM projects WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id DESC`)
          .all(...ids);

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
  const fundingRows = await db
    .prepare('SELECT project_id, COALESCE(SUM(amount),0) as total FROM project_funding GROUP BY project_id')
    .all();
  const fundingMap = {};
  fundingRows.forEach((r) => (fundingMap[r.project_id] = r.total));

  const projectSummaries = projects.map((p) => {
    const m = materialSpend[p.id] || { total: 0, paid: 0 };
    const l = laborSpend[p.id] || { total: 0, paid: 0 };
    const e = equipmentSpend[p.id] || { total: 0, paid: 0 };
    const committed = m.total + l.total + e.total;
    const paid = m.paid + l.paid + e.paid;
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

  const recentMaterials = await db
    .prepare('SELECT * FROM material_entries ORDER BY id DESC LIMIT 8')
    .all();
  const recentPayments = await db.prepare('SELECT * FROM payments ORDER BY id DESC LIMIT 8').all();

  return c.json({ projects: projectSummaries, totals, recentMaterials, recentPayments });
});

// ---------- Uploads (R2) ----------
// Degrades gracefully until the UPLOADS binding is added to wrangler.toml (R2 needs
// enabling on the Cloudflare account first — see the comment there).

app.post('/api/uploads', async (c) => {
  if (!c.env.UPLOADS) {
    return c.json({ error: 'Uploads are not configured yet on this deployment' }, 503);
  }
  const form = await c.req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return c.json({ error: 'file is required' }, 400);
  const key = `${crypto.randomUUID()}-${file.name}`;
  await c.env.UPLOADS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });
  return c.json({ key });
});

app.get('/uploads/:key', async (c) => {
  if (!c.env.UPLOADS) return c.text('Uploads are not configured yet on this deployment', 503);
  const obj = await c.env.UPLOADS.get(c.req.param('key'));
  if (!obj) return c.text('Not found', 404);
  return new Response(obj.body, {
    headers: { 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream' },
  });
});

// Everything else (style.css, app.js, login.html, ...) is a public static file.
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
